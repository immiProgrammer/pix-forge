use super::*;

enum Outcome {
    Written(ExportedImage),
    Skipped,
    Cancelled,
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn export_job(
    app: tauri::AppHandle,
    engine: Arc<Engine>,
    job_id: String,
    ids: Vec<String>,
    names: HashMap<String, String>,
    settings: Settings,
    destination: String,
    subfolder: String,
    roots: HashMap<String, String>,
    collision: String,
    cancel: Arc<AtomicBool>,
    performance: PerformanceOptions,
) -> Result<Progress> {
    tauri::async_runtime::spawn_blocking(move || {
        run_export(
            &engine,
            job_id,
            ids,
            names,
            settings,
            destination,
            subfolder,
            roots,
            collision,
            &cancel,
            &performance,
            |progress| {
                let _ = app.emit("export-progress", progress);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[allow(clippy::too_many_arguments)]
fn run_export(
    engine: &Engine,
    job_id: String,
    ids: Vec<String>,
    names: HashMap<String, String>,
    settings: Settings,
    destination: String,
    subfolder: String,
    roots: HashMap<String, String>,
    collision: String,
    cancel: &AtomicBool,
    performance: &PerformanceOptions,
    emit: impl Fn(Progress),
) -> Result<Progress> {
    if !["suffix", "skip", "replace"].contains(&collision.as_str()) {
        return Err("Unknown collision choice".into());
    }
    let destination =
        fs::canonicalize(destination).map_err(|e| format!("Destination unavailable: {e}"))?;
    if !destination.is_dir() {
        return Err("Choose an existing destination folder".into());
    }
    // A probe validates access without touching any output or source file.
    drop(
        tempfile::NamedTempFile::new_in(&destination)
            .map_err(|e| format!("Destination is not writable: {e}"))?,
    );
    let all = engine.assets.lock().unwrap();
    let sources: HashSet<String> = all
        .values()
        .map(|a| canonical_key(Path::new(&a.source_path)))
        .collect();
    let mut assets: Vec<Asset> = ids
        .iter()
        .map(|id| {
            all.get(id)
                .cloned()
                .ok_or_else(|| format!("Unknown image: {id}"))
        })
        .collect::<Result<_>>()?;
    drop(all);
    for asset in &mut assets {
        if let Ok(fresh) = refresh_source(asset) {
            *asset = fresh;
        }
    }
    let mut root_names = HashMap::<String, String>::new();
    let mut planned = HashSet::new();
    let mut plan = Vec::new();
    for asset in &assets {
        let root = roots.get(&asset.root_id).unwrap_or(&asset.root_name);
        if !root.is_empty() {
            if let Some(other) = root_names.insert(root.to_lowercase(), asset.root_id.clone()) {
                if other != asset.root_id {
                    return Err(format!("Duplicate root folder name: {root}"));
                }
            }
        }
        let relative = relative_path(
            asset,
            names.get(&asset.id).ok_or("Missing output name")?,
            &settings,
            &roots,
            &subfolder,
        )?;
        if !planned.insert(canonical_key(&relative)) && collision == "replace" {
            return Err(
                "Two planned images share an output path. Add a suffix or change their names."
                    .into(),
            );
        }
        // Validate all existing ancestors before committing the first image.
        let mut ancestor = destination.clone();
        for part in relative.parent().unwrap_or(Path::new("")).components() {
            ancestor.push(part.as_os_str());
            if ancestor.exists() {
                let actual = fs::canonicalize(&ancestor).map_err(|e| e.to_string())?;
                if !actual.starts_with(&destination) || !actual.is_dir() {
                    return Err(format!(
                        "Output directory is invalid or outside the destination: {}",
                        ancestor.display()
                    ));
                }
            }
        }
        let candidate = destination.join(&relative);
        if collision == "replace" && candidate.exists() {
            let actual = fs::canonicalize(&candidate).map_err(|e| e.to_string())?;
            if sources.contains(&canonical_key(&actual))
                || !actual.is_file()
                || fs::symlink_metadata(&candidate)
                    .map_err(|e| e.to_string())?
                    .file_type()
                    .is_symlink()
            {
                return Err(format!("Cannot replace source image or unsafe target: {}. Choose Add suffix or another destination.", candidate.display()));
            }
        }
        target_dimensions(asset.width, asset.height, &settings)?;
        plan.push(relative);
    }
    let mut progress = Progress {
        job_id,
        completed: 0,
        failed: 0,
        skipped: 0,
        total: assets.len(),
        current: String::new(),
        done: false,
        cancelled: false,
        failed_ids: Vec::new(),
        failures: HashMap::new(),
        outputs: Vec::new(),
    };
    let mut used = HashSet::new();
    let targets: Vec<_> = plan
        .iter()
        .map(|relative| reserve_target(&destination, relative, &sources, &collision, &mut used))
        .collect();
    let costs: Vec<_> = assets
        .iter()
        .map(|asset| estimated_image_memory(asset, &settings))
        .collect();
    let workers = performance
        .workers(engine.worker_count)
        .min(assets.len().max(1));
    progress.current = assets
        .first()
        .map(|asset| asset.original_name.clone())
        .unwrap_or_default();
    emit(progress.update());
    run_scheduled_workers(
        engine,
        &costs,
        workers,
        performance,
        cancel,
        memory_snapshot,
        |index, encoder_threads| {
            let target = match &targets[index] {
                Ok(Some(path)) => path,
                Ok(None) => return Ok(Outcome::Skipped),
                Err(error) => return Err(error.clone()),
            };
            let format = if settings.format == "original" {
                &assets[index].format
            } else {
                &settings.format
            };
            let (encoder_threads, _encoder_slots) = encoder_slots(engine, format, encoder_threads);
            write_image(
                engine,
                &assets[index],
                target,
                &destination,
                &sources,
                &settings,
                &collision,
                cancel,
                encoder_threads,
            )
        },
        |index, result| {
            let asset = &assets[index];
            progress.current = asset.original_name.clone();
            match result {
                Ok(Outcome::Written(output)) => {
                    progress.completed += 1;
                    progress.outputs.push(output);
                }
                Ok(Outcome::Skipped) => progress.skipped += 1,
                Ok(Outcome::Cancelled) => {}
                Err(_) if cancel.load(Ordering::Relaxed) => {}
                Err(error) => {
                    progress.failed += 1;
                    progress.failed_ids.push(asset.id.clone());
                    progress.failures.insert(asset.id.clone(), error.clone());
                    progress.current = format!("{}: {error}", asset.original_name);
                }
            }
            emit(progress.update());
        },
    );
    let order: HashMap<_, _> = assets
        .iter()
        .enumerate()
        .map(|(index, asset)| (asset.id.as_str(), index))
        .collect();
    progress
        .outputs
        .sort_by_key(|output| order[output.id.as_str()]);
    progress.done = true;
    progress.cancelled = cancel.load(Ordering::Relaxed);
    emit(progress.clone());
    Ok(progress)
}

fn reserve_target(
    destination: &Path,
    relative: &Path,
    sources: &HashSet<String>,
    collision: &str,
    used: &mut HashSet<String>,
) -> Result<Option<PathBuf>> {
    let mut target = destination.join(relative);
    let conflict = |path: &Path| path.exists() || used.contains(&canonical_key(path));
    if conflict(&target) {
        match collision {
            "skip" => return Ok(None),
            "suffix" => {
                let parent = target
                    .parent()
                    .ok_or("Missing output directory")?
                    .to_path_buf();
                let stem = target
                    .file_stem()
                    .ok_or("Missing output name")?
                    .to_string_lossy()
                    .into_owned();
                let ext = target
                    .extension()
                    .ok_or("Missing output extension")?
                    .to_string_lossy()
                    .into_owned();
                let mut index = 1;
                while conflict(&target) {
                    target = parent.join(format!("{stem}-{index}.{ext}"));
                    index += 1;
                }
            }
            _ => {}
        }
    }
    validate_target(&target, sources)?;
    used.insert(canonical_key(&target));
    Ok(Some(target))
}

fn validate_target(target: &Path, sources: &HashSet<String>) -> Result<()> {
    if sources.contains(&canonical_key(target)) {
        return Err("Export would overwrite a source image".into());
    }
    if target.exists() {
        let actual = fs::canonicalize(target).map_err(|error| error.to_string())?;
        if sources.contains(&canonical_key(&actual))
            || !actual.is_file()
            || fs::symlink_metadata(target)
                .map_err(|error| error.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("Output changed to a source image or unsafe target".into());
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn write_image(
    engine: &Engine,
    asset: &Asset,
    target: &Path,
    destination: &Path,
    sources: &HashSet<String>,
    settings: &Settings,
    collision: &str,
    cancel: &AtomicBool,
    encoder_threads: usize,
) -> Result<Outcome> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Cancelled);
    }
    let fresh = refresh_source(asset)?;
    if fresh.source_version != asset.source_version {
        return Err("Source changed after export planning; retry this image.".into());
    }
    let relative = target
        .strip_prefix(destination)
        .map_err(|error| error.to_string())?;
    let parent = ensure_directory(destination, relative.parent().unwrap_or(Path::new("")))?;
    validate_target(target, sources)?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(&parent).map_err(|error| error.to_string())?;
    let dimensions = target_dimensions(fresh.width, fresh.height, settings)?;
    let passthrough = settings.format == "original"
        && !settings.compress_original
        && dimensions == (fresh.width, fresh.height);
    if passthrough {
        let mut input = fs::File::open(&fresh.source_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut input, temporary.as_file_mut()).map_err(|error| error.to_string())?;
    } else if let Some(mut cached) = cached_encoded_file(engine, &fresh, settings) {
        // Stream an actual encoded preview; do not read it back into a large Vec.
        std::io::copy(&mut cached, temporary.as_file_mut()).map_err(|error| error.to_string())?;
    } else {
        let (data, _, _, _) =
            encode_with_threads(None, &fresh, settings, Some(cancel), encoder_threads)?;
        temporary
            .write_all(&data)
            .map_err(|error| error.to_string())?;
        // data and all decoded pixels are released before the next queued image.
    }
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Cancelled);
    }
    if source_version(&fs::metadata(&fresh.source_path).map_err(|error| error.to_string())?)?
        != fresh.source_version
    {
        return Err("Source changed during export; retry this image.".into());
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    // Recheck ancestors and source protection immediately before the atomic commit.
    ensure_directory(destination, relative.parent().unwrap_or(Path::new("")))?;
    validate_target(target, sources)?;
    let output_bytes = temporary
        .as_file()
        .metadata()
        .map_err(|error| error.to_string())?
        .len();
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Cancelled);
    }
    if collision == "replace" {
        temporary
            .persist(target)
            .map_err(|error| error.to_string())?;
    } else {
        temporary
            .persist_noclobber(target)
            .map_err(|error| format!("Output changed during export: {error}"))?;
    }
    Ok(Outcome::Written(ExportedImage {
        id: asset.id.clone(),
        input_path: asset.source_path.clone(),
        output_path: relative.to_string_lossy().replace('\\', "/"),
        input_bytes: fresh.bytes,
        output_bytes,
    }))
}

// A worker immediately takes the next image after finishing. Only small progress
// records cross the channel; decoded pixels and encoded buffers stay in workers.
#[allow(clippy::too_many_arguments)]
fn run_scheduled_workers<T: Send>(
    engine: &Engine,
    costs: &[u64],
    workers: usize,
    performance: &PerformanceOptions,
    cancel: &AtomicBool,
    sample_available: impl Fn() -> scheduler::MemorySample + Sync,
    task: impl Fn(usize, usize) -> Result<T> + Sync,
    mut complete: impl FnMut(usize, Result<T>),
) {
    use std::sync::mpsc;
    let queue = scheduler::AdaptiveQueue::new(costs, performance, sample_available);
    let (sender, receiver) = mpsc::sync_channel(workers.max(1));
    std::thread::scope(|scope| {
        for _ in 0..workers.min(costs.len()) {
            let sender = sender.clone();
            let task = &task;
            let queue = &queue;
            scope.spawn(move || {
                while let Some(reservation) = queue.take(cancel) {
                    let index = reservation.index;
                    let permit =
                        tauri::async_runtime::block_on(engine.workers.clone().acquire_owned());
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let result = match permit {
                        Ok(_permit) => {
                            let threads = reservation.encoder_threads(engine.worker_count, workers);
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                task(index, threads)
                            }))
                            .unwrap_or_else(|_| Err("Export worker failed unexpectedly".into()))
                        }
                        Err(error) => Err(error.to_string()),
                    };
                    drop(reservation);
                    if sender.send((index, result)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(sender);
        for (index, result) in receiver {
            complete(index, result);
        }
    });
}

#[cfg(test)]
fn run_workers<T: Send>(
    engine: &Engine,
    count: usize,
    workers: usize,
    cancel: &AtomicBool,
    task: impl Fn(usize) -> Result<T> + Sync,
    complete: impl FnMut(usize, Result<T>),
) {
    run_scheduled_workers(
        engine,
        &vec![1; count],
        workers,
        &PerformanceOptions::default(),
        cancel,
        || scheduler::MemorySample {
            available: 64 * 1024 * 1024 * 1024,
            process: 0,
        },
        |index, _| task(index),
        complete,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicUsize, Barrier};

    #[test]
    #[ignore = "Set PIXFORGE_BENCH_IMAGES and run --release --ignored --nocapture"]
    fn benchmark_export_queue() {
        let directory = std::env::var("PIXFORGE_BENCH_IMAGES").expect("Set PIXFORGE_BENCH_IMAGES");
        let mut engine = Engine::new();
        let mut paths: Vec<_> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("jpg"))
            })
            .collect();
        paths.sort();
        let assets: Vec<_> = paths
            .iter()
            .map(|path| import_one(&engine, path, path, false).unwrap())
            .collect();
        assert!(!assets.is_empty());
        let config = Settings {
            format: "webp".into(),
            resize: true,
            max_width: "1200".into(),
            ..settings()
        };
        let run = |engine: &Engine| {
            let destination = tempfile::tempdir().unwrap();
            let start = std::time::Instant::now();
            let progress = run_export(
                engine,
                "benchmark".into(),
                assets.iter().map(|a| a.id.clone()).collect(),
                assets
                    .iter()
                    .map(|a| (a.id.clone(), a.stem.clone()))
                    .collect(),
                config.clone(),
                destination.path().to_string_lossy().into_owned(),
                String::new(),
                HashMap::new(),
                "suffix".into(),
                &AtomicBool::new(false),
                &PerformanceOptions::default(),
                |_| {},
            )
            .unwrap();
            assert_eq!(progress.completed, assets.len());
            start.elapsed()
        };
        let threads = std::thread::available_parallelism().unwrap().get();
        engine.worker_count = 1;
        engine.workers = Arc::new(tokio::sync::Semaphore::new(1));
        let sequential = run(&engine);
        engine.worker_count = worker_count_for_threads(threads);
        engine.workers = Arc::new(tokio::sync::Semaphore::new(engine.worker_count));
        let parallel = run(&engine);
        for asset in &assets {
            processed(&engine, asset, &config).unwrap();
        }
        let cached = run(&engine);
        println!("{} product JPGs -> WebP q80 max1200: sequential={sequential:?}, adaptive={parallel:?}, cached={cached:?}, CPU_threads={threads}, worker_ceiling={}", assets.len(), engine.worker_count);
    }

    fn fixtures(engine: &Engine, directory: &Path, count: usize) -> Vec<Asset> {
        (0..count)
            .map(|index| {
                let path = directory.join(format!("photo-{index}.png"));
                image::RgbaImage::from_pixel(12, 8, image::Rgba([index as u8, 70, 120, 255]))
                    .save(&path)
                    .unwrap();
                import_one(engine, &path, &path, false).unwrap()
            })
            .collect()
    }

    fn settings() -> Settings {
        Settings {
            format: "png".into(),
            quality: 80,
            resize: false,
            max_width: String::new(),
            max_height: String::new(),
            upscale: false,
            compress_original: false,
            png_compression: "fast".into(),
            background: "#ffffff".into(),
        }
    }

    fn export(
        engine: &Engine,
        assets: &[Asset],
        destination: &Path,
        collision: &str,
        cancel: &AtomicBool,
        emit: impl Fn(Progress),
    ) -> Result<Progress> {
        run_export(
            engine,
            "test-export".into(),
            assets.iter().map(|a| a.id.clone()).collect(),
            assets
                .iter()
                .map(|a| (a.id.clone(), a.stem.clone()))
                .collect(),
            settings(),
            destination.to_string_lossy().into_owned(),
            String::new(),
            HashMap::new(),
            collision.into(),
            cancel,
            &PerformanceOptions::default(),
            emit,
        )
    }

    #[test]
    fn export_encoders_follow_cpu_policy_and_keep_result_order() {
        for threads in [2, 4, 8] {
            let mut engine = Engine::new();
            engine.worker_count = worker_count_for_threads(threads);
            engine.workers = Arc::new(tokio::sync::Semaphore::new(engine.worker_count));
            let sources = tempfile::tempdir().unwrap();
            let assets = fixtures(&engine, sources.path(), engine.worker_count);
            let active = AtomicUsize::new(0);
            let peak = AtomicUsize::new(0);
            let barrier = Barrier::new(engine.worker_count);
            let results = export_batch(&engine, &assets, &AtomicBool::new(false), |asset| {
                let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(current, Ordering::SeqCst);
                barrier.wait();
                active.fetch_sub(1, Ordering::SeqCst);
                Ok(asset.id.clone())
            });
            assert_eq!(peak.load(Ordering::SeqCst), engine.worker_count);
            assert_eq!(
                results.into_iter().collect::<Result<Vec<_>>>().unwrap(),
                assets.iter().map(|a| a.id.clone()).collect::<Vec<_>>()
            );
            assert_eq!(engine.workers.available_permits(), engine.worker_count);
        }
    }

    #[test]
    fn export_respects_slots_already_used_by_other_background_work() {
        let mut engine = Engine::new();
        engine.worker_count = 4;
        engine.workers = Arc::new(tokio::sync::Semaphore::new(4));
        let occupied = engine.workers.clone().try_acquire_many_owned(2).unwrap();
        let sources = tempfile::tempdir().unwrap();
        let assets = fixtures(&engine, sources.path(), 4);
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let barrier = Barrier::new(2);
        let results = export_batch(&engine, &assets, &AtomicBool::new(false), |_| {
            peak.fetch_max(active.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
            barrier.wait();
            active.fetch_sub(1, Ordering::SeqCst);
            Ok(())
        });
        assert!(results.into_iter().all(|result| result.is_ok()));
        assert_eq!(peak.load(Ordering::SeqCst), 2);
        assert_eq!(engine.workers.available_permits(), 2);
        drop(occupied);
        assert_eq!(engine.workers.available_permits(), 4);
    }

    #[test]
    fn mixed_size_exports_run_small_images_beside_a_large_image_within_budget() {
        use std::sync::atomic::AtomicU64;
        let mut engine = Engine::new();
        engine.worker_count = 3;
        engine.workers = Arc::new(tokio::sync::Semaphore::new(3));
        let mib = 1024 * 1024;
        let costs = [80 * mib, 120 * mib, 24 * mib, 24 * mib];
        let options = PerformanceOptions {
            memory_limit_mib: Some(128),
            ..Default::default()
        };
        let (small_done, wait) = std::sync::mpsc::channel();
        let wait = Mutex::new(wait);
        let active = AtomicU64::new(0);
        let peak = AtomicU64::new(0);
        let mut completed = Vec::new();
        run_scheduled_workers(
            &engine,
            &costs,
            3,
            &options,
            &AtomicBool::new(false),
            || scheduler::MemorySample {
                available: 4 * 1024 * mib,
                process: 0,
            },
            |index, _| {
                peak.fetch_max(
                    active.fetch_add(costs[index], Ordering::SeqCst) + costs[index],
                    Ordering::SeqCst,
                );
                if index == 0 {
                    for _ in 0..2 {
                        wait.lock()
                            .unwrap()
                            .recv_timeout(std::time::Duration::from_secs(2))
                            .map_err(|_| "Small images were blocked")?;
                    }
                } else if index >= 2 {
                    small_done.send(()).unwrap();
                }
                active.fetch_sub(costs[index], Ordering::SeqCst);
                Ok(())
            },
            |index, result| {
                result.unwrap();
                completed.push(index);
            },
        );
        assert_eq!(completed.len(), 4);
        assert!(peak.load(Ordering::SeqCst) <= 128 * mib);
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn continuous_queue_does_not_wait_for_a_slow_image() {
        let mut engine = Engine::new();
        // This test needs two active workers regardless of the host's CPU count.
        // The production policy deliberately leaves only one slot on two-thread CI runners.
        engine.worker_count = 2;
        engine.workers = Arc::new(tokio::sync::Semaphore::new(2));
        let (release, wait) = std::sync::mpsc::channel();
        let wait = Mutex::new(wait);
        let mut completed = Vec::new();
        run_workers(
            &engine,
            3,
            2,
            &AtomicBool::new(false),
            |index| {
                if index == 0 {
                    wait.lock()
                        .unwrap()
                        .recv_timeout(std::time::Duration::from_secs(2))
                        .map_err(|_| "A slow image blocked later work")?;
                } else if index == 2 {
                    release.send(()).unwrap();
                }
                Ok(index)
            },
            |index, result| {
                result.unwrap();
                completed.push(index);
            },
        );
        assert_eq!(completed.len(), 3);
    }

    #[test]
    fn export_streams_the_exact_cached_preview_bytes() {
        let engine = Engine::new();
        let sources = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let assets = fixtures(&engine, sources.path(), 1);
        let config = settings();
        let encoded = processed(&engine, &assets[0], &config).unwrap();
        let bytes = fs::read(&encoded.cache_path).unwrap();
        let fresh = refresh_source(&assets[0]).unwrap();
        assert!(cached_encoded_file(&engine, &fresh, &config).is_some());
        let progress = export(
            &engine,
            &assets,
            destination.path(),
            "suffix",
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(progress.completed, 1);
        assert_eq!(
            fs::read(destination.path().join(&progress.outputs[0].output_path)).unwrap(),
            bytes
        );
        let changed = Settings {
            quality: 30,
            ..config
        };
        assert!(cached_encoded_file(&engine, &fresh, &changed).is_none());
    }

    #[test]
    fn concurrent_export_preserves_folders_and_suffixes_without_changing_sources() {
        let mut engine = Engine::new();
        engine.worker_count = 4;
        engine.workers = Arc::new(tokio::sync::Semaphore::new(4));
        let sources = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let mut assets = fixtures(&engine, sources.path(), 7);
        let originals: Vec<_> = assets
            .iter()
            .map(|a| fs::read(&a.source_path).unwrap())
            .collect();
        for asset in &mut assets {
            asset.root_id = "catalog-root".into();
            asset.root_name = "catalog".into();
            asset.relative_folder = "shoes".into();
            asset.stem = "product".into();
            engine
                .assets
                .lock()
                .unwrap()
                .insert(asset.id.clone(), asset.clone());
        }
        fs::create_dir_all(destination.path().join("catalog/shoes")).unwrap();
        let existing = destination.path().join("catalog/shoes/product.png");
        fs::write(&existing, b"existing").unwrap();
        let progress = export(
            &engine,
            &assets,
            destination.path(),
            "suffix",
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!((progress.completed, progress.failed), (7, 0));
        for (index, output) in progress.outputs.iter().enumerate() {
            assert_eq!(
                output.output_path,
                format!("catalog/shoes/product-{}.png", index + 1)
            );
            let path = destination.path().join(&output.output_path);
            assert_eq!(image::open(&path).unwrap().dimensions(), (12, 8));
            assert_eq!(output.output_bytes, fs::metadata(&path).unwrap().len());
            assert_eq!(output.input_bytes, originals[index].len() as u64);
            assert_eq!(
                fs::read(&assets[index].source_path).unwrap(),
                originals[index]
            );
        }
        assert_eq!(fs::read(existing).unwrap(), b"existing");
    }

    #[test]
    fn cancellation_keeps_completed_files_and_leaves_no_temporary_files() {
        let engine = Engine::new();
        let sources = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let assets = fixtures(&engine, sources.path(), 7);
        let cancel = AtomicBool::new(false);
        let progress = export(
            &engine,
            &assets,
            destination.path(),
            "suffix",
            &cancel,
            |progress| {
                if progress.completed == 1 {
                    cancel.store(true, Ordering::Relaxed);
                }
            },
        )
        .unwrap();
        assert!(progress.done && progress.cancelled);
        assert!(progress.completed >= 1 && progress.completed <= assets.len());
        assert_eq!(progress.failed, 0);
        assert_eq!(
            fs::read_dir(destination.path()).unwrap().count(),
            progress.completed
        );
        assert!(destination
            .path()
            .join(&progress.outputs[0].output_path)
            .exists());
    }

    #[test]
    fn failed_image_does_not_interrupt_other_workers() {
        let engine = Engine::new();
        let sources = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let assets = fixtures(&engine, sources.path(), 3);
        fs::remove_file(&assets[1].source_path).unwrap();
        let progress = export(
            &engine,
            &assets,
            destination.path(),
            "suffix",
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!((progress.completed, progress.failed), (2, 1));
        assert_eq!(progress.failed_ids, [assets[1].id.clone()]);
        assert_eq!(fs::read_dir(destination.path()).unwrap().count(), 2);
    }

    #[test]
    fn skip_and_source_overwrite_protection_remain_safe() {
        let engine = Engine::new();
        let sources = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let assets = fixtures(&engine, sources.path(), 3);
        for asset in &assets {
            fs::write(
                destination.path().join(format!("{}.png", asset.stem)),
                b"existing",
            )
            .unwrap();
        }
        let progress = export(
            &engine,
            &assets,
            destination.path(),
            "skip",
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(
            (progress.completed, progress.skipped, progress.failed),
            (0, 3, 0)
        );
        assert!(export(
            &engine,
            &assets,
            sources.path(),
            "replace",
            &AtomicBool::new(false),
            |_| {}
        )
        .is_err());
        for asset in &assets {
            assert_eq!(
                fs::read(destination.path().join(format!("{}.png", asset.stem))).unwrap(),
                b"existing"
            );
            assert_eq!(
                image::open(&asset.source_path).unwrap().dimensions(),
                (12, 8)
            );
        }
    }
}

#[cfg(test)]
fn export_batch<T: Send>(
    engine: &Engine,
    assets: &[Asset],
    cancel: &AtomicBool,
    encode_image: impl Fn(&Asset) -> Result<T> + Sync,
) -> Vec<Result<T>> {
    let mut results = Vec::new();
    run_workers(
        engine,
        assets.len(),
        engine.worker_count,
        cancel,
        |index| encode_image(&assets[index]),
        |index, result| results.push((index, result)),
    );
    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, result)| result).collect()
}
