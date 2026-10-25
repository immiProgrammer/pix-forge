use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Condvar, Mutex,
    },
    time::{Duration, Instant},
};

const MIB: u64 = 1024 * 1024;

#[derive(Clone, Copy)]
pub(super) struct MemorySample {
    pub available: u64,
    pub process: u64,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum PerformanceMode {
    LowMemory,
    #[default]
    Balanced,
    MaximumSpeed,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct PerformanceOptions {
    pub mode: PerformanceMode,
    pub worker_limit: Option<usize>,
    #[serde(rename = "memoryLimitMiB")]
    pub memory_limit_mib: Option<u64>,
}

impl PerformanceOptions {
    pub fn workers(&self, cpu_ceiling: usize) -> usize {
        let preset = match self.mode {
            PerformanceMode::LowMemory => 4,
            PerformanceMode::Balanced => 32,
            PerformanceMode::MaximumSpeed => 64,
        };
        cpu_ceiling
            .min(preset)
            .min(self.worker_limit.unwrap_or(64).clamp(1, 64))
            .max(1)
    }

    fn memory_budget(&self, available: u64, owned_growth: u64, reserved: u64) -> u64 {
        let (percent, default_cap) = match self.mode {
            PerformanceMode::LowMemory => (20, 2 * 1024 * MIB),
            PerformanceMode::Balanced => (40, 8 * 1024 * MIB),
            PerformanceMode::MaximumSpeed => (70, 32 * 1024 * MIB),
        };
        // Account for measured growth in our process, not estimated reservations:
        // allocations by other apps shrink the pool, our own active buffers do not.
        let target = available
            .saturating_add(owned_growth)
            .saturating_mul(percent)
            / 100;
        let cap = self
            .memory_limit_mib
            .map(|value| value.clamp(128, 65536) * MIB)
            .unwrap_or(default_cap);
        target
            .min(cap)
            .min(reserved.saturating_add(available.saturating_sub(512 * MIB)))
    }
}

struct State {
    pending: VecDeque<usize>,
    reserved: u64,
    active: usize,
    budget: u64,
    refreshed: Instant,
    baseline_process: u64,
}

impl State {
    fn reserve(&mut self, costs: &[u64]) -> Option<(usize, u64)> {
        // Choose the first fitting image, not simply the next filename. A large
        // image cannot block smaller images that fit beside running work.
        let position = self.pending.iter().position(|&index| {
            self.active == 0 || costs[index] <= self.budget.saturating_sub(self.reserved)
        })?;
        let index = self.pending.remove(position)?;
        let cost = costs[index];
        self.reserved = self.reserved.saturating_add(cost);
        self.active += 1;
        Some((index, cost))
    }
}

pub(super) struct AdaptiveQueue<'a, F> {
    costs: &'a [u64],
    options: &'a PerformanceOptions,
    sample_available: F,
    state: Mutex<State>,
    changed: Condvar,
}

impl<'a, F: Fn() -> MemorySample> AdaptiveQueue<'a, F> {
    pub fn new(costs: &'a [u64], options: &'a PerformanceOptions, sample_available: F) -> Self {
        let sample = sample_available();
        let budget = options.memory_budget(sample.available, 0, 0);
        Self {
            costs,
            options,
            sample_available,
            state: Mutex::new(State {
                pending: (0..costs.len()).collect(),
                reserved: 0,
                active: 0,
                budget,
                refreshed: Instant::now(),
                baseline_process: sample.process,
            }),
            changed: Condvar::new(),
        }
    }

    pub fn take(&self, cancel: &AtomicBool) -> Option<Reservation<'_, 'a, F>> {
        let mut state = self.state.lock().unwrap();
        loop {
            if cancel.load(Ordering::Relaxed) || state.pending.is_empty() {
                return None;
            }
            if state.refreshed.elapsed() >= Duration::from_millis(500) {
                let sample = (self.sample_available)();
                state.budget = self.options.memory_budget(
                    sample.available,
                    sample.process.saturating_sub(state.baseline_process),
                    state.reserved,
                );
                state.refreshed = Instant::now();
                self.changed.notify_all();
            }
            if let Some((index, cost)) = state.reserve(self.costs) {
                return Some(Reservation {
                    queue: self,
                    index,
                    cost,
                });
            }
            state = self
                .changed
                .wait_timeout(state, Duration::from_millis(100))
                .unwrap()
                .0;
        }
    }
}

pub(super) struct Reservation<'q, 'a, F> {
    queue: &'q AdaptiveQueue<'a, F>,
    pub index: usize,
    cost: u64,
}
impl<F> Reservation<'_, '_, F> {
    pub fn encoder_threads(&self, cpu_ceiling: usize, workers: usize) -> usize {
        let state = self.queue.state.lock().unwrap();
        let parallel = (state.budget / self.cost.max(1)).max(1) as usize;
        let parallel = parallel
            .min(workers)
            .min(state.pending.len() + state.active)
            .max(1);
        (cpu_ceiling / parallel).clamp(1, 8)
    }
}

impl<F> Drop for Reservation<'_, '_, F> {
    fn drop(&mut self) {
        let mut state = self.queue.state.lock().unwrap();
        state.reserved = state.reserved.saturating_sub(self.cost);
        state.active -= 1;
        self.queue.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    #[test]
    fn presets_scale_with_ram_and_respect_manual_limits() {
        let balanced = PerformanceOptions::default();
        assert!(balanced.memory_budget(32 * 1024 * MIB, 0, 0) > 1536 * MIB);
        assert_eq!(
            balanced.memory_budget(32 * 1024 * MIB, 0, 0),
            8 * 1024 * MIB
        );
        let fast = PerformanceOptions {
            mode: PerformanceMode::MaximumSpeed,
            ..Default::default()
        };
        assert!(
            fast.memory_budget(32 * 1024 * MIB, 0, 0)
                > balanced.memory_budget(32 * 1024 * MIB, 0, 0)
        );
        let limited = PerformanceOptions {
            worker_limit: Some(3),
            memory_limit_mib: Some(1024),
            ..fast
        };
        assert_eq!(limited.workers(64), 3);
        assert_eq!(limited.memory_budget(32 * 1024 * MIB, 0, 0), 1024 * MIB);
        assert_eq!(limited.workers(2), 2);
    }
    #[test]
    fn own_memory_growth_is_not_mistaken_for_pressure_from_other_apps() {
        let options = PerformanceOptions::default();
        let initial = options.memory_budget(8 * 1024 * MIB, 0, 0);
        assert_eq!(
            options.memory_budget(7 * 1024 * MIB, 1024 * MIB, 1024 * MIB),
            initial
        );
        assert!(options.memory_budget(4 * 1024 * MIB, 1024 * MIB, 1024 * MIB) < initial);
    }
    #[test]
    fn frontend_options_round_trip_with_the_expected_field_names() {
        let json = r#"{"mode":"maximum-speed","workerLimit":12,"memoryLimitMiB":8192}"#;
        let options: PerformanceOptions = serde_json::from_str(json).unwrap();
        assert_eq!(options.workers(64), 12);
        assert_eq!(options.memory_limit_mib, Some(8192));
        let result = serde_json::to_value(options).unwrap();
        assert_eq!(result["memoryLimitMiB"], 8192);
        assert_eq!(result["mode"], "maximum-speed");
    }
    #[test]
    fn defaults_and_partial_preferences_remain_compatible() {
        let options: PerformanceOptions = serde_json::from_str("{}").unwrap();
        assert_eq!(options.workers(64), 32);
        assert_eq!(options.memory_limit_mib, None);
    }

    #[test]
    fn mixed_sizes_fill_available_memory_without_a_large_image_blocking_small_ones() {
        let mut state = State {
            pending: (0..4).collect(),
            reserved: 0,
            active: 0,
            budget: 100,
            refreshed: Instant::now(),
            baseline_process: 0,
        };
        let costs = [60, 90, 20, 20];
        assert_eq!(state.reserve(&costs), Some((0, 60)));
        assert_eq!(state.reserve(&costs), Some((2, 20)));
        assert_eq!(state.reserve(&costs), Some((3, 20)));
        assert_eq!(state.reserved, 100);
        assert_eq!(state.reserve(&costs), None);
        state.reserved = 0;
        state.active = 0;
        assert_eq!(state.reserve(&costs), Some((1, 90)));
    }

    #[test]
    fn oversized_images_run_alone_and_reservations_are_released() {
        let options = PerformanceOptions {
            memory_limit_mib: Some(128),
            ..Default::default()
        };
        let costs = [256 * MIB, 16 * MIB];
        let queue = AdaptiveQueue::new(&costs, &options, || MemorySample {
            available: 4 * 1024 * MIB,
            process: 0,
        });
        let cancel = AtomicBool::new(false);
        let reservation = queue.take(&cancel).unwrap();
        assert_eq!(reservation.index, 0);
        assert!(queue.state.lock().unwrap().reserve(&costs).is_none());
        drop(reservation);
        assert_eq!(queue.take(&cancel).unwrap().index, 1);
        assert_eq!(queue.state.lock().unwrap().reserved, 0);
    }

    #[test]
    fn pressure_shrinks_budget_and_recovered_memory_expands_it() {
        let options = PerformanceOptions::default();
        let available = AtomicU64::new(8 * 1024 * MIB);
        let costs = [1024 * MIB, 1024 * MIB, 1024 * MIB];
        let queue = AdaptiveQueue::new(&costs, &options, || MemorySample {
            available: available.load(Ordering::Relaxed),
            process: 0,
        });
        let cancel = AtomicBool::new(false);
        let first = queue.take(&cancel).unwrap();
        available.store(256 * MIB, Ordering::Relaxed);
        {
            let mut state = queue.state.lock().unwrap();
            state.budget =
                options.memory_budget(available.load(Ordering::Relaxed), 0, state.reserved);
            assert!(state.reserve(&costs).is_none());
            state.refreshed = Instant::now() - Duration::from_secs(1);
        }
        available.store(16 * 1024 * MIB, Ordering::Relaxed);
        let next = queue.take(&cancel).unwrap();
        assert_eq!(next.index, 1);
        drop(next);
        drop(first);
        assert_eq!(queue.state.lock().unwrap().reserved, 0);
    }

    #[test]
    fn waiting_work_can_be_cancelled() {
        let options = PerformanceOptions {
            memory_limit_mib: Some(128),
            ..Default::default()
        };
        let costs = [128 * MIB, 128 * MIB];
        let queue = AdaptiveQueue::new(&costs, &options, || MemorySample {
            available: 4 * 1024 * MIB,
            process: 0,
        });
        let cancel = AtomicBool::new(false);
        let first = queue.take(&cancel).unwrap();
        std::thread::scope(|scope| {
            let waiting = scope.spawn(|| queue.take(&cancel).is_none());
            cancel.store(true, Ordering::Relaxed);
            assert!(waiting.join().unwrap());
        });
        drop(first);
    }
}
