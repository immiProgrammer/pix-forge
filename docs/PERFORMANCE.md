# Processing performance

## Automatic scheduling

The desktop engine detects available logical CPU threads. Its shared image-worker
ceiling is `max(1, min(threads - 1, 64))`. Imports, preview jobs, and export jobs
take slots from the same semaphore.

Choose **Export performance** in the desktop settings. Preferences are saved and
apply to the next export, without changing quality, filenames, or preview caches.

| Preset             | Automatic RAM share | Automatic RAM ceiling | Image-worker ceiling |
| ------------------ | ------------------: | --------------------: | -------------------: |
| Low memory         |                 20% |                 2 GiB |                    4 |
| Balanced (default) |                 40% |                 8 GiB |                   32 |
| Maximum speed      |                 70% |                32 GiB |                   64 |

The actual worker count cannot exceed the detected CPU ceiling. Optional **Worker
limit** and **RAM budget (GB)** fields can lower the worker ceiling and set a RAM
ceiling; blank means Auto. The RAM ceiling accepts 128 MiB to 64 GiB. Preset RAM
shares and available headroom still apply when a manual ceiling is set. These
parallel-export controls are disabled in browser mode.

Every image reserves its own estimated working memory based on its source size,
output size, and encoder. A large queued image cannot block smaller ones that fit
beside running work. The scheduler samples free RAM and native-process working
memory every 500 ms. It accounts for measured growth in its own process so its
allocations are not confused with pressure from other apps, and leaves at least
512 MiB of currently available headroom when admitting additional work.

When other apps consume RAM, the scheduler stops admitting additional images
until reservations fit again. When RAM becomes available, waiting workers can
start more images. Running encoders are allowed to finish. A single image larger
than the configured budget can run alone to avoid stalling the queue.

RAM reservations are estimates, not hard allocation limits: codec buffers, the
WebView, operating-system caches, and an exceptionally large image can push actual
app memory above the processing budget.

Workers take another fitting image as soon as they finish. No batch of decoded
images or encoded byte arrays is retained by the coordinator. Each worker releases
its pixel buffers before taking another image; the progress channel carries only
small result records. Collision paths are reserved in input order; completed files
are reported immediately and sorted into input order in the final report.

When fewer images fit concurrently, WebP/AVIF can borrow additional available CPU
slots without blocking (up to two encoder threads for WebP, eight for AVIF). This
avoids multiple encoders each assuming they have all CPU threads. Individual
encodes cannot be forcibly interrupted; cancellation checks run between stages
and before committing output files.

## Avoiding repeated work and large copies

- A full-resolution encoded preview can be streamed directly into the output
  temporary file when source version and settings match. Missing or evicted cache
  entries are encoded normally.
- Unchanged **Keep source format** exports stream the source bytes; they do not
  allocate a buffer the size of the source file.
- RGB/RGBA buffers are borrowed when their layout already matches the encoder.
  Opaque JPEG exports skip alpha conversion/compositing.
- `fast_image_resize` selects CPU vector instructions at runtime, retaining
  Lanczos3 filtering, alpha-aware resampling, and 16-bit channel support.
- `jpeg-encoder` uses AVX2 where supported, with full 4:4:4 chroma detail. Other
  processors use its fallback path.
- WebP uses method 3; AVIF uses speed 8. Quality remains the user's 0-100 value.
  Faster effort can produce larger files than slower compression settings.
  Preview statistics always come from the actual encoded output.

Originals remain protected, destination collisions are checked again before the
atomic commit, and cancellation drops incomplete temporary files. Sources changed
after export planning fail that image rather than using an outdated export plan.

## GPU support

Encoding currently uses CPU libraries. No GPU encoding is advertised or enabled.
The NVIDIA RTX 3060 detected on the development machine does not automatically
accelerate these libraries. NVIDIA's nvJPEG is a separate JPEG-specific backend;
using it would require its CUDA runtime/library integration and deployment tests,
and would not accelerate the existing WebP, AVIF, or PNG encoders.

See the primary documentation for [CPU resize acceleration](https://docs.rs/fast_image_resize/latest/fast_image_resize/),
[SIMD JPEG encoding](https://docs.rs/jpeg-encoder/latest/jpeg_encoder/), and
[NVIDIA's JPEG backend](https://docs.nvidia.com/cuda/nvjpeg/).

## Measure an optimized build

Use `pnpm dist:app` to build the standalone release executable. Ordinary
`pnpm tauri dev` runs unoptimized Rust code and is not a production-speed benchmark.
For UI hot reload with optimized native code, use `pnpm tauri dev --release`.

The ignored native benchmarks can be run separately from correctness tests:

```powershell
. ./scripts/windows-env.ps1
$env:PIXFORGE_BENCH_IMAGES = Join-Path $projectRoot 'docs/media/products'
cargo test --locked --release --target x86_64-pc-windows-msvc --manifest-path apps/desktop/src-tauri/Cargo.toml benchmark_ -- --ignored --nocapture --test-threads=1
```

The export benchmark compares the new engine with one worker, adaptive workers,
and a fully warm processed-preview cache. It is not a comparison against the full
previous application. The resize and JPEG benchmarks compare the previous
algorithm/backend directly with the new one on the same generated 24 MP image.

Observed on a Ryzen 5 5600G (12 logical threads), optimized Windows x64 build:

| Workload                                                        |                   Reference |                 Optimized |
| --------------------------------------------------------------- | --------------------------: | ------------------------: |
| 24 MP RGB to 1.5 MP, Lanczos3 resize                            |                      332 ms |                     22 ms |
| Native-process sampled peak for the resize benchmark            |                     171 MiB |                    93 MiB |
| 24 MP RGB to JPEG, quality 80                                   |                      382 ms |                    237 ms |
| Eight bundled product JPEGs to WebP, quality 80, max width 1200 |         872 ms (one worker) | 189 ms (adaptive workers) |
| Same export, actual encoded previews already cached             | 189 ms (uncached, adaptive) |                      7 ms |

These are single local observations, not universal speed guarantees. Input
dimensions, image content, format, compression effort, disk speed, competing
processes, and available memory affect results. JPEG benchmark file sizes were
3,180,041 bytes before and 3,187,118 bytes after; the backend change does not
promise identical compressed bytes.

To sample native-process peak memory for resizing, run the memory benchmark in
separate processes with `PIXFORGE_BENCH_RESIZER=previous` and then `simd`:

```powershell
$env:PIXFORGE_BENCH_RESIZER = 'previous'
cargo test --locked --release --target x86_64-pc-windows-msvc --manifest-path apps/desktop/src-tauri/Cargo.toml benchmark_resize_memory -- --ignored --nocapture
$env:PIXFORGE_BENCH_RESIZER = 'simd'
cargo test --locked --release --target x86_64-pc-windows-msvc --manifest-path apps/desktop/src-tauri/Cargo.toml benchmark_resize_memory -- --ignored --nocapture
```

This samples the native test process, not the complete app's WebView/GPU memory.
