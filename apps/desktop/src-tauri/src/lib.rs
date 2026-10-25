mod export;
mod scheduler;
use image::{DynamicImage, GenericImageView, ImageDecoder, ImageEncoder, ImageFormat, ImageReader};
use scheduler::PerformanceOptions;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{BufReader, Cursor, Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

type Result<T> = std::result::Result<T, String>;
const CACHE_BUDGET: u64 = 512 * 1024 * 1024;
const DECODED_CACHE_BUDGET: usize = 128 * 1024 * 1024;
struct DecodedSource {
    id: String,
    version: String,
    image: Arc<DynamicImage>,
}
fn worker_count_for_threads(threads: usize) -> usize {
    threads.saturating_sub(1).clamp(1, 64)
}
fn memory_snapshot() -> scheduler::MemorySample {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let process = sysinfo::get_current_pid()
        .ok()
        .and_then(|pid| {
            system.refresh_processes_specifics(
                sysinfo::ProcessesToUpdate::Some(&[pid]),
                true,
                sysinfo::ProcessRefreshKind::nothing().with_memory(),
            );
            system.process(pid).map(|process| process.memory())
        })
        .unwrap_or(0);
    scheduler::MemorySample {
        available: match system.available_memory() {
            0 => 1024 * 1024 * 1024,
            available => available,
        },
        process,
    }
}
fn estimated_image_memory(asset: &Asset, settings: &Settings) -> u64 {
    let (width, height) = target_dimensions(asset.width, asset.height, settings)
        .unwrap_or((asset.width, asset.height));
    if settings.format == "original"
        && !settings.compress_original
        && (width, height) == (asset.width, asset.height)
    {
        return 8 * 1024 * 1024;
    }
    let source = u64::from(asset.width) * u64::from(asset.height);
    let output = u64::from(width) * u64::from(height);
    let format = if settings.format == "original" {
        &asset.format
    } else {
        &settings.format
    };
    let encoder_bytes = if format == "avif" { 48 } else { 16 };
    source
        .saturating_mul(8)
        .saturating_add(output.saturating_mul(encoder_bytes))
        .saturating_add(32 * 1024 * 1024)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    id: String,
    source_path: String,
    relative_folder: String,
    root_id: String,
    root_name: String,
    original_name: String,
    stem: String,
    format: String,
    width: u32,
    height: u32,
    bytes: u64,
    thumbnail: String,
    #[serde(default)]
    source_version: String,
    excluded: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    format: String,
    quality: u8,
    resize: bool,
    max_width: String,
    max_height: String,
    upscale: bool,
    compress_original: bool,
    png_compression: String,
    background: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Processed {
    bytes: u64,
    width: u32,
    height: u32,
    format: String,
    cache_path: String,
    key: String,
    source_version: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CardSource {
    path: String,
    source_version: String,
    width: u32,
    height: u32,
    bytes: u64,
    format: String,
}
#[derive(Default)]
struct Cache {
    values: HashMap<String, Processed>,
    order: VecDeque<String>,
    bytes: u64,
}
struct Engine {
    assets: Mutex<HashMap<String, Asset>>,
    active: Mutex<HashSet<String>>,
    workers: Arc<tokio::sync::Semaphore>,
    worker_count: usize,
    cache: Mutex<Cache>,
    decoded: Mutex<Option<DecodedSource>>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    directory: tempfile::TempDir,
}
impl Engine {
    fn new() -> Self {
        let threads = std::thread::available_parallelism().map_or(1, |count| count.get());
        let worker_count = worker_count_for_threads(threads);
        Self {
            assets: Mutex::new(HashMap::new()),
            active: Mutex::new(HashSet::new()),
            workers: Arc::new(tokio::sync::Semaphore::new(worker_count)),
            worker_count,
            cache: Mutex::new(Cache::default()),
            decoded: Mutex::new(None),
            jobs: Mutex::new(HashMap::new()),
            directory: tempfile::tempdir().expect("Cannot create image cache"),
        }
    }
}
struct ImportSlot<'a> {
    active: &'a Mutex<HashSet<String>>,
    id: String,
    committed: bool,
}
impl Drop for ImportSlot<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.active.lock().unwrap().remove(&self.id);
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanItem {
    request_id: String,
    asset: Option<Asset>,
    issue: Option<String>,
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn canonical_key(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}
fn format_name(format: ImageFormat) -> Result<String> {
    Ok(match format {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
        ImageFormat::WebP => "webp",
        ImageFormat::Avif => "avif",
        ImageFormat::Gif => "gif",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Tiff => "tiff",
        _ => return Err("Unsupported image format".into()),
    }
    .into())
}
fn animation_check(path: &Path, format: ImageFormat) -> Result<()> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    match format {
        ImageFormat::Gif => {
            // Count frame descriptors while skipping compressed sub-blocks.
            // Detecting animation must not decode full frames during import.
            fn skip_blocks(reader: &mut (impl Read + Seek)) -> std::io::Result<()> {
                loop {
                    let mut size = [0];
                    reader.read_exact(&mut size)?;
                    if size[0] == 0 {
                        return Ok(());
                    }
                    reader.seek(SeekFrom::Current(i64::from(size[0])))?;
                }
            }
            let inspect = || -> std::io::Result<usize> {
                let mut reader = BufReader::new(file);
                let mut header = [0; 13];
                reader.read_exact(&mut header)?;
                if header[10] & 0x80 != 0 {
                    reader.seek(SeekFrom::Current(3 * (1_i64 << ((header[10] & 7) + 1))))?;
                }
                let mut frames = 0;
                loop {
                    let mut marker = [0];
                    reader.read_exact(&mut marker)?;
                    match marker[0] {
                        0x2c => {
                            frames += 1;
                            if frames == 2 {
                                return Ok(frames);
                            }
                            let mut descriptor = [0; 9];
                            reader.read_exact(&mut descriptor)?;
                            if descriptor[8] & 0x80 != 0 {
                                reader.seek(SeekFrom::Current(
                                    3 * (1_i64 << ((descriptor[8] & 7) + 1)),
                                ))?;
                            }
                            reader.seek(SeekFrom::Current(1))?; // LZW code size
                            skip_blocks(&mut reader)?;
                        }
                        0x21 => {
                            reader.seek(SeekFrom::Current(1))?;
                            skip_blocks(&mut reader)?;
                        }
                        0x3b if frames > 0 => return Ok(frames),
                        _ => {
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "Invalid GIF structure",
                            ))
                        }
                    }
                }
            };
            if inspect().map_err(|error| error.to_string())? > 1 {
                return Err(
                    "Animation preservation is unsupported. Please import a still image.".into(),
                );
            }
        }
        ImageFormat::WebP => {
            let decoder = image::codecs::webp::WebPDecoder::new(BufReader::new(file))
                .map_err(|e| e.to_string())?;
            if decoder.has_animation() {
                return Err(
                    "Animated WebP is unsupported; animation will not be flattened.".into(),
                );
            }
        }
        ImageFormat::Png => {
            let decoder = image::codecs::png::PngDecoder::new(BufReader::new(file))
                .map_err(|e| e.to_string())?;
            if decoder.is_apng().map_err(|e| e.to_string())? {
                return Err("Animated PNG is unsupported; animation will not be flattened.".into());
            }
        }
        ImageFormat::Avif => {
            let mut header = [0; 256];
            let n = file.read(&mut header).map_err(|e| e.to_string())?;
            if header[..n].windows(4).any(|s| s == b"avis") {
                return Err("Animated AVIF is unsupported.".into());
            }
        }
        _ => {}
    };
    Ok(())
}
fn decode(path: &Path) -> Result<(DynamicImage, ImageFormat)> {
    let reader = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let format = reader.format().ok_or("Unknown image format")?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    image.apply_orientation(orientation);
    Ok((image, format))
}
fn source_version(metadata: &fs::Metadata) -> Result<String> {
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    Ok(hash(&format!("{modified:?}:{}", metadata.len())))
}
fn source_info(path: &Path) -> Result<(u32, u32, String)> {
    let reader = ImageReader::open(path)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let format = reader.format().ok_or("Unsupported or unreadable file")?;
    let mut name = format_name(format)?;
    animation_check(path, format)?;
    // The image crate's AVIF decoder decodes pixels during construction.
    // Read AVIF dimensions from its container instead.
    let (width, height) = if format == ImageFormat::Avif {
        let size = imagesize::size(path).map_err(|error| error.to_string())?;
        (
            u32::try_from(size.width).map_err(|error| error.to_string())?,
            u32::try_from(size.height).map_err(|error| error.to_string())?,
        )
    } else {
        let mut decoder = reader.into_decoder().map_err(|error| error.to_string())?;
        let dimensions = decoder.dimensions();
        let orientation = decoder.orientation().map_err(|error| error.to_string())?;
        if orientation.to_exif() >= 5 {
            (dimensions.1, dimensions.0)
        } else {
            dimensions
        }
    };
    if width == 0 || height == 0 {
        return Err("Image has invalid dimensions".into());
    }
    // Keep the decoder's validated dimensions, without allocating a pixel buffer.
    if format == ImageFormat::Jpeg
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("jpeg"))
    {
        name = "jpeg".into();
    }
    Ok((width, height, name))
}
fn refresh_source(asset: &Asset) -> Result<Asset> {
    let metadata = fs::metadata(&asset.source_path).map_err(|error| error.to_string())?;
    let version = source_version(&metadata)?;
    if version == asset.source_version {
        return Ok(asset.clone());
    }
    if metadata.len() > 512 * 1024 * 1024 {
        return Err("Image exceeds the 512 MB input safety limit".into());
    }
    let (width, height, format) = source_info(Path::new(&asset.source_path))?;
    Ok(Asset {
        width,
        height,
        format,
        bytes: metadata.len(),
        source_version: version,
        ..asset.clone()
    })
}
fn import_one(engine: &Engine, path: &Path, root: &Path, folder: bool) -> Result<Asset> {
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let id = hash(&canonical_key(&canonical));
    if !engine.active.lock().unwrap().insert(id.clone()) {
        return Err("Already imported; duplicate skipped".into());
    }
    let mut slot = ImportSlot {
        active: &engine.active,
        id: id.clone(),
        committed: false,
    };
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if metadata.len() > 512 * 1024 * 1024 {
        return Err("Image exceeds the 512 MB input safety limit".into());
    }
    let (width, height, name) = source_info(&canonical)?;
    let parent = if folder {
        canonical
            .parent()
            .unwrap()
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/")
    } else {
        String::new()
    };
    let original_name = canonical.file_name().unwrap().to_string_lossy().to_string();
    let asset = Asset {
        id: id.clone(),
        source_path: canonical.to_string_lossy().into(),
        relative_folder: parent,
        root_id: if folder {
            hash(&canonical_key(root))
        } else {
            "loose-files".into()
        },
        root_name: if folder {
            root.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into()
        } else {
            String::new()
        },
        original_name,
        stem: canonical.file_stem().unwrap().to_string_lossy().into(),
        format: name,
        width,
        height,
        bytes: metadata.len(),
        thumbnail: canonical.to_string_lossy().into(),
        source_version: source_version(&metadata)?,
        excluded: false,
    };
    engine.assets.lock().unwrap().insert(id, asset.clone());
    slot.committed = true;
    Ok(asset)
}
struct ImportTask {
    path: Result<PathBuf>,
    root: PathBuf,
    folder: bool,
}
fn import_batch(
    engine: &Engine,
    entries: Vec<ImportTask>,
    mut on_result: impl FnMut(Result<Asset>),
) {
    std::thread::scope(|scope| {
        let handles: Vec<_> = entries
            .into_iter()
            .map(|task| {
                scope.spawn(move || {
                    let _permit = tauri::async_runtime::block_on(engine.workers.acquire())
                        .map_err(|e| e.to_string())?;
                    task.path.and_then(|path| {
                        import_one(engine, &path, &task.root, task.folder)
                            .map_err(|e| format!("{}: {e}", path.display()))
                    })
                })
            })
            .collect();
        // Join in discovery order so concurrent metadata reads do not reorder cards.
        for handle in handles {
            on_result(
                handle
                    .join()
                    .unwrap_or_else(|_| Err("Image import worker failed".into())),
            );
        }
    })
}
fn scan_paths(
    engine: &Engine,
    paths: Vec<String>,
    request_id: &str,
    on_item: impl Fn(&ScanItem),
) -> Vec<ScanItem> {
    let mut scanned = Vec::new();
    let mut seen = HashSet::new();
    let mut batch = Vec::with_capacity(engine.worker_count);
    let mut report = |result: Result<Asset>| {
        let (asset, issue) = match result {
            Ok(asset) => (Some(asset), None),
            Err(issue) => (None, Some(issue)),
        };
        let item = ScanItem {
            request_id: request_id.into(),
            asset,
            issue,
        };
        on_item(&item);
        scanned.push(item);
    };
    for source in paths {
        let root = match fs::canonicalize(&source) {
            Ok(path) => path,
            Err(error) => {
                import_batch(engine, std::mem::take(&mut batch), &mut report);
                report(Err(format!("{source}: {error}")));
                continue;
            }
        };
        let folder = root.is_dir();
        let entries: Box<dyn Iterator<Item = Result<PathBuf>>> = if folder {
            Box::new(
                WalkDir::new(&root)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(|entry| match entry {
                        Ok(entry) if entry.file_type().is_file() => Some(Ok(entry.into_path())),
                        Ok(_) => None,
                        Err(error) => Some(Err(error.to_string())),
                    }),
            )
        } else {
            Box::new(std::iter::once(Ok(root.clone())))
        };
        for entry in entries {
            // Resolve repeats in discovery order before concurrent workers start.
            let path = entry.and_then(|path| {
                let canonical = fs::canonicalize(&path)
                    .map_err(|error| format!("{}: {error}", path.display()))?;
                if !seen.insert(canonical_key(&canonical)) {
                    return Err(format!(
                        "{}: Already imported; duplicate skipped",
                        path.display()
                    ));
                }
                Ok(canonical)
            });
            batch.push(ImportTask {
                path,
                root: root.clone(),
                folder,
            });
            if batch.len() == engine.worker_count {
                import_batch(engine, std::mem::take(&mut batch), &mut report);
            }
        }
    }
    if !batch.is_empty() {
        import_batch(engine, batch, &mut report);
    }
    scanned
}
#[tauri::command]
async fn scan_images(
    app: tauri::AppHandle,
    engine: tauri::State<'_, Arc<Engine>>,
    paths: Vec<String>,
    request_id: String,
) -> Result<Vec<ScanItem>> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Return the completed batch as well as progressive events. The UI can
        // reconcile an event still in flight before removing its listener.
        scan_paths(&engine, paths, &request_id, |item| {
            if let Some(asset) = &item.asset {
                let _ = app.asset_protocol_scope().allow_file(&asset.source_path);
            }
            let _ = app.emit("scan-item", item);
        })
    })
    .await
    .map_err(|e| e.to_string())
}
fn target_dimensions(width: u32, height: u32, settings: &Settings) -> Result<(u32, u32)> {
    if !settings.resize {
        return Ok((width, height));
    }
    let limit = |s: &str| -> Result<f64> {
        if s.is_empty() {
            return Ok(f64::INFINITY);
        }
        let n = s
            .parse::<u32>()
            .map_err(|_| "Dimension limits must be positive whole numbers")?;
        if n == 0 || n > 50000 {
            return Err("Dimension limits must be between 1 and 50000 pixels".into());
        }
        Ok(n as f64)
    };
    let mut ratio = (limit(&settings.max_width)? / width as f64)
        .min(limit(&settings.max_height)? / height as f64);
    if !settings.upscale {
        ratio = ratio.min(1.0);
    }
    if !ratio.is_finite() {
        ratio = 1.0;
    }
    let w = (width as f64 * ratio).round().max(1.0) as u32;
    let h = (height as f64 * ratio).round().max(1.0) as u32;
    if (w as u64) * (h as u64) > 64_000_000 {
        return Err("Output exceeds the 64 megapixel processing limit".into());
    }
    Ok((w, h))
}
#[cfg(test)]
fn encode(asset: &Asset, settings: &Settings) -> Result<(Vec<u8>, u32, u32, String)> {
    encode_with_cache(None, asset, settings, None)
}
fn decoded_source(engine: Option<&Engine>, asset: &Asset) -> Result<Arc<DynamicImage>> {
    if let Some(engine) = engine {
        let cache = engine.decoded.lock().unwrap();
        if let Some(cached) = cache.as_ref() {
            if cached.id == asset.id && cached.version == asset.source_version {
                return Ok(cached.image.clone());
            }
        }
    }
    let image = Arc::new(decode(Path::new(&asset.source_path))?.0);
    if let Some(engine) = engine {
        let mut cache = engine.decoded.lock().unwrap();
        *cache = if image.as_bytes().len() <= DECODED_CACHE_BUDGET {
            Some(DecodedSource {
                id: asset.id.clone(),
                version: asset.source_version.clone(),
                image: image.clone(),
            })
        } else {
            None
        };
    }
    Ok(image)
}
fn check_preview_cancel(cancel: Option<&AtomicBool>) -> Result<()> {
    if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("Obsolete preview cancelled".into());
    }
    Ok(())
}
fn resize_image(image: &DynamicImage, width: u32, height: u32) -> Result<DynamicImage> {
    let mut output = DynamicImage::new(width, height, image.color());
    fast_image_resize::Resizer::new()
        .resize(image, &mut output, &fast_image_resize::ResizeOptions::new())
        .map_err(|error| error.to_string())?;
    Ok(output)
}
#[cfg(test)]
fn encode_with_cache(
    engine: Option<&Engine>,
    asset: &Asset,
    settings: &Settings,
    cancel: Option<&AtomicBool>,
) -> Result<(Vec<u8>, u32, u32, String)> {
    let threads = engine.map_or(1, |engine| engine.worker_count.min(8));
    encode_with_threads(engine, asset, settings, cancel, threads)
}
fn encode_jpeg(
    output: &mut Vec<u8>,
    rgb: &[u8],
    width: u32,
    height: u32,
    quality: u8,
) -> Result<()> {
    let width = u16::try_from(width).map_err(|_| "JPEG width exceeds 65535 pixels")?;
    let height = u16::try_from(height).map_err(|_| "JPEG height exceeds 65535 pixels")?;
    let mut encoder = jpeg_encoder::Encoder::new(output, quality.max(1));
    // Preserve full chroma detail instead of getting speed by dropping color resolution.
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1);
    encoder
        .encode(rgb, width, height, jpeg_encoder::ColorType::Rgb)
        .map_err(|error| error.to_string())
}
fn encode_with_threads(
    engine: Option<&Engine>,
    asset: &Asset,
    settings: &Settings,
    cancel: Option<&AtomicBool>,
    encoder_threads: usize,
) -> Result<(Vec<u8>, u32, u32, String)> {
    check_preview_cancel(cancel)?;
    let fresh = refresh_source(asset)?;
    let asset = &fresh;
    let format = if settings.format == "original" {
        asset.format.clone()
    } else {
        settings.format.clone()
    };
    let (width, height) = target_dimensions(asset.width, asset.height, settings)?;
    if settings.format == "original"
        && !settings.compress_original
        && width == asset.width
        && height == asset.height
    {
        return Ok((
            fs::read(&asset.source_path).map_err(|e| e.to_string())?,
            width,
            height,
            format,
        ));
    }
    let decoded = decoded_source(engine, asset)?;
    check_preview_cancel(cancel)?;
    let resized = if decoded.dimensions() != (width, height) {
        Some(resize_image(&decoded, width, height)?)
    } else {
        None
    };
    let image = resized.as_ref().unwrap_or(decoded.as_ref());
    check_preview_cancel(cancel)?;
    let mut output = Vec::new();
    let quality = settings.quality.min(100);
    match format.as_str() {
        "webp" => {
            let converted;
            let encoder = if let Some(rgb) = image.as_rgb8() {
                webp::Encoder::from_rgb(rgb.as_raw(), width, height)
            } else if let Some(rgba) = image.as_rgba8() {
                webp::Encoder::from_rgba(rgba.as_raw(), width, height)
            } else {
                converted = image.to_rgba8();
                webp::Encoder::from_rgba(converted.as_raw(), width, height)
            };
            let mut config =
                webp::WebPConfig::new().map_err(|_| "Cannot initialize WebP encoder")?;
            config.quality = quality as f32;
            config.method = 3;
            config.thread_level = i32::from(encoder_threads > 1);
            output = encoder
                .encode_advanced(&config)
                .map_err(|error| format!("WebP encoding failed: {error:?}"))?
                .to_vec();
        }
        "avif" => {
            let converted;
            let rgba = if let Some(rgba) = image.as_rgba8() {
                rgba
            } else {
                converted = image.to_rgba8();
                &converted
            };
            image::codecs::avif::AvifEncoder::new_with_speed_quality(
                &mut output,
                8,
                quality.max(1),
            )
            .with_num_threads(Some(encoder_threads.max(1)))
            .write_image(
                rgba.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| e.to_string())?;
        }
        "jpg" | "jpeg" => {
            if !image.color().has_alpha() {
                let converted;
                let rgb = if let Some(rgb) = image.as_rgb8() {
                    rgb
                } else {
                    converted = image.to_rgb8();
                    &converted
                };
                encode_jpeg(&mut output, rgb.as_raw(), width, height, quality)?;
                return Ok((output, width, height, format));
            }
            let hex = settings.background.trim_start_matches('#');
            let bg = u32::from_str_radix(hex, 16).unwrap_or(0xffffff);
            let background = [
                ((bg >> 16) & 255) as u8,
                ((bg >> 8) & 255) as u8,
                (bg & 255) as u8,
            ];
            let converted;
            let rgba = if let Some(rgba) = image.as_rgba8() {
                rgba
            } else {
                converted = image.to_rgba8();
                &converted
            };
            let mut rgb = vec![0; width as usize * height as usize * 3];
            for (output_pixel, pixel) in rgb.chunks_exact_mut(3).zip(rgba.as_raw().chunks_exact(4))
            {
                let a = pixel[3] as u32;
                for i in 0..3 {
                    output_pixel[i] =
                        ((pixel[i] as u32 * a + background[i] as u32 * (255 - a) + 127) / 255)
                            as u8;
                }
            }
            encode_jpeg(&mut output, &rgb, width, height, quality)?;
        }
        "png" => {
            use image::codecs::png::{CompressionType, FilterType, PngEncoder};
            let compression = match settings.png_compression.as_str() {
                "fast" => CompressionType::Fast,
                "best" => CompressionType::Best,
                _ => CompressionType::Default,
            };
            // Preserve 8/16-bit channel samples for lossless PNG output.
            let converted;
            let png_image = match image.color() {
                image::ColorType::Rgb32F | image::ColorType::Rgba32F => {
                    converted = DynamicImage::ImageRgba16(image.to_rgba16());
                    &converted
                }
                _ => image,
            };
            PngEncoder::new_with_quality(&mut output, compression, FilterType::Adaptive)
                .write_image(
                    png_image.as_bytes(),
                    width,
                    height,
                    png_image.color().into(),
                )
                .map_err(|e| e.to_string())?;
        }
        "bmp" => {
            image
                .write_to(&mut Cursor::new(&mut output), ImageFormat::Bmp)
                .map_err(|e| e.to_string())?;
        }
        "tif" | "tiff" => {
            image
                .write_to(&mut Cursor::new(&mut output), ImageFormat::Tiff)
                .map_err(|e| e.to_string())?;
        }
        "gif" => {
            image
                .write_to(&mut Cursor::new(&mut output), ImageFormat::Gif)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported output format".into()),
    };
    Ok((output, width, height, format))
}
fn processed(engine: &Engine, asset: &Asset, settings: &Settings) -> Result<Processed> {
    processed_cancellable(engine, asset, settings, None)
}
fn processing_key(asset: &Asset, settings: &Settings) -> Result<String> {
    Ok(hash(&format!(
        "{}:{}:{}",
        asset.id,
        asset.source_version,
        serde_json::to_string(settings).map_err(|e| e.to_string())?
    )))
}
fn cached_encoded_file(engine: &Engine, asset: &Asset, settings: &Settings) -> Option<fs::File> {
    let key = processing_key(asset, settings).ok()?;
    let cache = engine.cache.lock().unwrap();
    fs::File::open(&cache.values.get(&key)?.cache_path).ok()
}
// Callers already hold one shared worker slot. Extra encoder threads may borrow
// free slots, but never wait while holding their first slot.
fn encoder_slots(
    engine: &Engine,
    format: &str,
    wanted: usize,
) -> (usize, Option<tokio::sync::OwnedSemaphorePermit>) {
    let wanted = match format {
        "avif" => wanted.min(8),
        "webp" => wanted.min(2),
        _ => 1,
    };
    let wanted = wanted.min(engine.workers.available_permits() + 1).max(1);
    let extra = if wanted > 1 {
        engine
            .workers
            .clone()
            .try_acquire_many_owned((wanted - 1) as u32)
            .ok()
    } else {
        None
    };
    (if extra.is_some() { wanted } else { 1 }, extra)
}
fn processed_cancellable(
    engine: &Engine,
    asset: &Asset,
    settings: &Settings,
    cancel: Option<&AtomicBool>,
) -> Result<Processed> {
    check_preview_cancel(cancel)?;
    let fresh = refresh_source(asset)?;
    let asset = &fresh;
    let key = processing_key(asset, settings)?;
    if let Some(cached) = engine.cache.lock().unwrap().values.get(&key).cloned() {
        if Path::new(&cached.cache_path).exists() {
            return Ok(cached);
        }
    }
    let output_format = if settings.format == "original" {
        &asset.format
    } else {
        &settings.format
    };
    let (threads, _encoder_slots) = encoder_slots(engine, output_format, engine.worker_count);
    let (data, width, height, format) =
        encode_with_threads(Some(engine), asset, settings, cancel, threads)?;
    check_preview_cancel(cancel)?;
    let after = fs::metadata(&asset.source_path).map_err(|error| error.to_string())?;
    if source_version(&after)? != asset.source_version {
        return Err("Source changed during processing; retry this image.".into());
    }
    let path = engine.directory.path().join(format!("{key}.{format}"));
    let mut temporary =
        tempfile::NamedTempFile::new_in(engine.directory.path()).map_err(|e| e.to_string())?;
    temporary.write_all(&data).map_err(|e| e.to_string())?;
    temporary.persist(&path).map_err(|e| e.to_string())?;
    let result = Processed {
        bytes: data.len() as u64,
        width,
        height,
        format,
        cache_path: path.to_string_lossy().into(),
        key: key.clone(),
        source_version: asset.source_version.clone(),
    };
    let mut cache = engine.cache.lock().unwrap();
    cache.bytes += result.bytes;
    cache.order.push_back(key.clone());
    cache.values.insert(key.clone(), result.clone());
    while cache.bytes > CACHE_BUDGET && cache.order.len() > 1 {
        if let Some(old) = cache.order.pop_front() {
            if let Some(value) = cache.values.remove(&old) {
                cache.bytes = cache.bytes.saturating_sub(value.bytes);
                let _ = fs::remove_file(value.cache_path);
            }
        }
    }
    Ok(result)
}
fn card_source(engine: &Engine, id: &str, fallback: bool) -> Result<CardSource> {
    let original = engine
        .assets
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or("Unknown image ID")?;
    let asset = refresh_source(&original)?;
    if let Some(stored) = engine.assets.lock().unwrap().get_mut(id) {
        *stored = asset.clone();
    }
    let path = if fallback {
        processed(
            engine,
            &asset,
            &Settings {
                format: "webp".into(),
                quality: 75,
                resize: true,
                max_width: "400".into(),
                max_height: "300".into(),
                upscale: false,
                compress_original: false,
                png_compression: "fast".into(),
                background: "#ffffff".into(),
            },
        )?
        .cache_path
    } else {
        asset.source_path.clone()
    };
    Ok(CardSource {
        path,
        source_version: asset.source_version,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        format: asset.format,
    })
}
#[tauri::command]
async fn card_image(
    engine: tauri::State<'_, Arc<Engine>>,
    id: String,
    fallback: bool,
    request_id: String,
) -> Result<CardSource> {
    let engine = engine.inner().clone();
    let flag = Arc::new(AtomicBool::new(false));
    engine
        .jobs
        .lock()
        .unwrap()
        .insert(request_id.clone(), flag.clone());
    let cleanup = engine.clone();
    let result = async {
        let permit = if fallback {
            Some(
                engine
                    .workers
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            if flag.load(Ordering::Relaxed) {
                return Err("Card image request cancelled".into());
            }
            let result = card_source(&engine, &id, fallback)?;
            if flag.load(Ordering::Relaxed) {
                return Err("Card image request cancelled".into());
            }
            Ok(result)
        })
        .await
        .map_err(|error| error.to_string())?
    }
    .await;
    cleanup.jobs.lock().unwrap().remove(&request_id);
    result
}
#[tauri::command]
async fn process_image(
    engine: tauri::State<'_, Arc<Engine>>,
    id: String,
    settings: Settings,
    request_id: String,
) -> Result<Processed> {
    let engine = engine.inner().clone();
    let flag = Arc::new(AtomicBool::new(false));
    engine
        .jobs
        .lock()
        .unwrap()
        .insert(request_id.clone(), flag.clone());
    let cleanup = engine.clone();
    let result = async {
        let permit = engine
            .workers
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            if flag.load(Ordering::Relaxed) {
                return Err("Obsolete preview cancelled".into());
            }
            let asset = engine
                .assets
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or("Unknown image ID")?;
            let result = processed_cancellable(&engine, &asset, &settings, Some(&flag))?;
            if flag.load(Ordering::Relaxed) {
                return Err("Obsolete preview cancelled".into());
            }
            Ok(result)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    .await;
    cleanup.jobs.lock().unwrap().remove(&request_id);
    result
}
#[tauri::command]
async fn source_preview(engine: tauri::State<'_, Arc<Engine>>, id: String) -> Result<Processed> {
    let engine = engine.inner().clone();
    let permit = engine
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let asset = engine
            .assets
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or("Unknown image ID")?;
        let settings = Settings {
            format: "png".into(),
            quality: 100,
            resize: false,
            max_width: String::new(),
            max_height: String::new(),
            upscale: false,
            compress_original: false,
            png_compression: "fast".into(),
            background: "#ffffff".into(),
        };
        processed(&engine, &asset, &settings)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn validate_component(name: &str) -> Result<()> {
    if name.is_empty()
        || name.trim() != name
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || name == "."
        || name == ".."
        || name.as_bytes().len() > 240
    {
        return Err(format!("Unsafe filename: {name}"));
    }
    let base = name.split('.').next().unwrap_or("").to_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&base.as_str())
        || ((base.starts_with("COM") || base.starts_with("LPT"))
            && base.len() == 4
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
    {
        return Err(format!("Reserved filename: {name}"));
    }
    Ok(())
}
fn relative_path(
    asset: &Asset,
    name: &str,
    settings: &Settings,
    roots: &HashMap<String, String>,
    subfolder: &str,
) -> Result<PathBuf> {
    validate_component(name)?;
    let ext = if settings.format == "original" {
        asset.format.as_str()
    } else {
        settings.format.as_str()
    };
    validate_component(ext)?;
    let mut out = PathBuf::new();
    let root = roots.get(&asset.root_id).unwrap_or(&asset.root_name);
    for part in [subfolder, root.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
    {
        validate_component(part)?;
        out.push(part);
    }
    for part in Path::new(&asset.relative_folder).components() {
        match part {
            Component::Normal(p) => {
                validate_component(&p.to_string_lossy())?;
                out.push(p)
            }
            _ => return Err("Invalid relative folder".into()),
        }
    }
    out.push(format!("{name}.{ext}"));
    Ok(out)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job_id: String,
    completed: usize,
    failed: usize,
    skipped: usize,
    total: usize,
    current: String,
    done: bool,
    cancelled: bool,
    failed_ids: Vec<String>,
    failures: HashMap<String, String>,
    outputs: Vec<ExportedImage>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedImage {
    id: String,
    input_path: String,
    output_path: String,
    input_bytes: u64,
    output_bytes: u64,
}
impl Progress {
    fn update(&self) -> Self {
        Self {
            job_id: self.job_id.clone(),
            completed: self.completed,
            failed: self.failed,
            skipped: self.skipped,
            total: self.total,
            current: self.current.clone(),
            done: self.done,
            cancelled: self.cancelled,
            failed_ids: self.failed_ids.clone(),
            failures: self.failures.clone(),
            outputs: Vec::new(),
        }
    }
}
#[tauri::command]
fn cancel_export(engine: tauri::State<'_, Arc<Engine>>, job_id: String) {
    if let Some(flag) = engine.jobs.lock().unwrap().get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
}
#[tauri::command]
fn forget_images(engine: tauri::State<'_, Arc<Engine>>, ids: Vec<String>) {
    let mut decoded = engine.decoded.lock().unwrap();
    if decoded
        .as_ref()
        .is_some_and(|cached| ids.contains(&cached.id))
    {
        *decoded = None;
    }
    let mut active = engine.active.lock().unwrap();
    let mut assets = engine.assets.lock().unwrap();
    for id in ids {
        active.remove(&id);
        assets.remove(&id);
    }
}
fn ensure_directory(destination: &Path, relative: &Path) -> Result<PathBuf> {
    let mut current = destination.to_path_buf();
    for part in relative.components() {
        let Component::Normal(part) = part else {
            return Err("Invalid export directory".into());
        };
        current.push(part);
        if !current.exists() {
            fs::create_dir(&current).map_err(|e| e.to_string())?;
        }
        let canonical = fs::canonicalize(&current).map_err(|e| e.to_string())?;
        if !canonical.starts_with(destination) {
            return Err("Output folder resolves outside the selected destination".into());
        }
        current = canonical;
    }
    Ok(current)
}
#[tauri::command]
async fn export_images(
    app: tauri::AppHandle,
    engine: tauri::State<'_, Arc<Engine>>,
    job_id: String,
    ids: Vec<String>,
    names: HashMap<String, String>,
    settings: Settings,
    destination: String,
    subfolder: String,
    roots: HashMap<String, String>,
    collision: String,
    performance: Option<PerformanceOptions>,
) -> Result<Progress> {
    let engine = engine.inner().clone();
    let flag = Arc::new(AtomicBool::new(false));
    engine
        .jobs
        .lock()
        .unwrap()
        .insert(job_id.clone(), flag.clone());
    let engine_cleanup = engine.clone();
    let cleanup_id = job_id.clone();
    let result = export::export_job(
        app,
        engine,
        job_id,
        ids,
        names,
        settings,
        destination,
        subfolder,
        roots,
        collision,
        flag,
        performance.unwrap_or_default(),
    )
    .await;
    engine_cleanup.jobs.lock().unwrap().remove(&cleanup_id);
    result
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let engine = Arc::new(Engine::new());
            app.asset_protocol_scope()
                .allow_directory(engine.directory.path(), true)?;
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_images,
            card_image,
            process_image,
            source_preview,
            export_images,
            cancel_export,
            forget_images
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run PixForge");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Run with --release --ignored --nocapture to measure resizing on this CPU"]
    fn benchmark_resize_backends() {
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_fn(6000, 4000, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 239) as u8, ((x + y) % 233) as u8])
        }));
        let baseline = std::time::Instant::now();
        let previous = image.resize_exact(1500, 1000, image::imageops::FilterType::Lanczos3);
        let baseline = baseline.elapsed();
        let optimized = std::time::Instant::now();
        let resized = resize_image(&image, 1500, 1000).unwrap();
        let optimized = optimized.elapsed();
        assert_eq!(previous.dimensions(), resized.dimensions());
        println!("24 MP RGB -> 1.5 MP Lanczos3: previous={baseline:?}, SIMD={optimized:?}, speedup={:.2}x; CPU={:?}",
            baseline.as_secs_f64() / optimized.as_secs_f64(), fast_image_resize::Resizer::new().cpu_extensions());
    }
    #[test]
    #[ignore = "Run with --release --ignored --nocapture to measure JPEG encoding"]
    fn benchmark_jpeg_backends() {
        let image = image::RgbImage::from_fn(6000, 4000, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 239) as u8, ((x + y) % 233) as u8])
        });
        let baseline = std::time::Instant::now();
        let mut old = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut old, 80)
            .encode(image.as_raw(), 6000, 4000, image::ExtendedColorType::Rgb8)
            .unwrap();
        let baseline = baseline.elapsed();
        let optimized = std::time::Instant::now();
        let mut output = Vec::new();
        encode_jpeg(&mut output, image.as_raw(), 6000, 4000, 80).unwrap();
        let optimized = optimized.elapsed();
        assert_eq!(
            image::load_from_memory(&output).unwrap().dimensions(),
            (6000, 4000)
        );
        println!("24 MP JPEG q80: previous={baseline:?}, SIMD={optimized:?}, speedup={:.2}x, previous_bytes={}, new_bytes={}",
            baseline.as_secs_f64()/optimized.as_secs_f64(), old.len(), output.len());
    }
    #[test]
    #[ignore = "Set PIXFORGE_BENCH_RESIZER=previous or simd; run this benchmark in separate processes"]
    fn benchmark_resize_memory() {
        use std::sync::atomic::AtomicU64;
        let mode = std::env::var("PIXFORGE_BENCH_RESIZER").unwrap_or_else(|_| "simd".into());
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_fn(6000, 4000, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 239) as u8, ((x + y) % 233) as u8])
        }));
        let stop = AtomicBool::new(false);
        let peak = AtomicU64::new(0);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                let pid = sysinfo::get_current_pid().unwrap();
                let mut system = sysinfo::System::new();
                while !stop.load(Ordering::Relaxed) {
                    system.refresh_processes_specifics(
                        sysinfo::ProcessesToUpdate::Some(&[pid]),
                        true,
                        sysinfo::ProcessRefreshKind::nothing().with_memory(),
                    );
                    if let Some(process) = system.process(pid) {
                        peak.fetch_max(process.memory(), Ordering::Relaxed);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
            });
            let output = if mode == "previous" {
                image.resize_exact(1500, 1000, image::imageops::FilterType::Lanczos3)
            } else {
                resize_image(&image, 1500, 1000).unwrap()
            };
            std::hint::black_box(&output);
            stop.store(true, Ordering::Relaxed);
        });
        println!(
            "24 MP RGB resize backend={mode}, sampled native-process peak={} MiB",
            peak.load(Ordering::Relaxed) / (1024 * 1024)
        );
    }
    #[test]
    fn jpeg_composites_transparency_and_rejects_oversized_dimensions() {
        let directory = tempfile::tempdir().unwrap();
        let asset = source_asset(directory.path());
        image::RgbaImage::from_pixel(24, 16, image::Rgba([255, 0, 0, 128]))
            .save(&asset.source_path)
            .unwrap();
        let mut config = settings();
        config.format = "jpg".into();
        config.background = "#0000ff".into();
        let (data, _, _, _) = encode(&asset, &config).unwrap();
        let decoded = image::load_from_memory(&data).unwrap().to_rgb8();
        let pixel = decoded.get_pixel(0, 0);
        assert!(
            (122..=134).contains(&pixel[0]) && pixel[1] <= 6 && (121..=133).contains(&pixel[2])
        );
        assert!(encode_jpeg(&mut Vec::new(), &[], 65536, 1, 80).is_err());
    }
    #[test]
    fn decoded_cache_reuses_pixels_and_invalidates_modified_sources() {
        let directory = tempfile::tempdir().unwrap();
        let engine = Engine::new();
        let asset = refresh_source(&source_asset(directory.path())).unwrap();
        let first = decoded_source(Some(&engine), &asset).unwrap();
        let mut config = settings();
        config.format = "webp".into();
        config.quality = 50;
        let cached = encode_with_cache(Some(&engine), &asset, &config, None).unwrap();
        let uncached = encode(&asset, &config).unwrap();
        assert_eq!(cached, uncached);
        assert!(Arc::ptr_eq(
            &first,
            &decoded_source(Some(&engine), &asset).unwrap()
        ));
        let file = fs::OpenOptions::new()
            .write(true)
            .open(&asset.source_path)
            .unwrap();
        let later = fs::metadata(&asset.source_path)
            .unwrap()
            .modified()
            .unwrap()
            + std::time::Duration::from_secs(10);
        file.set_times(fs::FileTimes::new().set_modified(later))
            .unwrap();
        let modified = refresh_source(&asset).unwrap();
        assert_ne!(modified.source_version, asset.source_version);
        let updated = decoded_source(Some(&engine), &modified).unwrap();
        assert!(!Arc::ptr_eq(&first, &updated));
        let other = Asset {
            id: "another-source".into(),
            ..modified
        };
        decoded_source(Some(&engine), &other).unwrap();
        let retained = engine.decoded.lock().unwrap();
        assert_eq!(retained.as_ref().unwrap().id, other.id);
        assert!(retained.as_ref().unwrap().image.as_bytes().len() <= DECODED_CACHE_BUDGET);
    }
    #[test]
    fn obsolete_preview_stops_before_decoding_or_caching() {
        let directory = tempfile::tempdir().unwrap();
        let engine = Engine::new();
        let asset = source_asset(directory.path());
        let cancelled = AtomicBool::new(true);
        assert!(processed_cancellable(&engine, &asset, &settings(), Some(&cancelled)).is_err());
        assert!(engine.decoded.lock().unwrap().is_none());
        assert!(engine.cache.lock().unwrap().values.is_empty());
    }
    #[test]
    fn import_and_direct_cards_do_not_generate_cached_images() {
        let directory = tempfile::tempdir().unwrap();
        let source = source_asset(directory.path());
        let engine = Engine::new();
        let path = Path::new(&source.source_path);
        let asset = import_one(&engine, path, path, false).unwrap();
        let card = card_source(&engine, &asset.id, false).unwrap();
        assert_eq!((card.width, card.height), (24, 16));
        assert_eq!(card.path, asset.source_path);
        assert_eq!(asset.thumbnail, asset.source_path);
        assert!(!asset.source_version.is_empty());
        assert_eq!(engine.cache.lock().unwrap().values.len(), 0);
        assert_eq!(fs::read_dir(engine.directory.path()).unwrap().count(), 0);
    }
    #[test]
    fn card_and_processed_cache_track_modification_time_and_file_size() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("product.bmp");
        let first_time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        let later_time = first_time + std::time::Duration::from_secs(2);
        let write = |width, color, modified| {
            image::RgbImage::from_pixel(width, 400, image::Rgb(color))
                .save(&path)
                .unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
        };
        write(600, [220, 30, 40], first_time);
        let engine = Engine::new();
        let asset = import_one(&engine, &path, &path, false).unwrap();
        let first = card_source(&engine, &asset.id, true).unwrap();
        let encoded = processed(&engine, &asset, &settings()).unwrap();
        let repeated = card_source(&engine, &asset.id, true).unwrap();
        assert_eq!(first.path, repeated.path);
        let thumb = image::open(&first.path).unwrap();
        assert!(thumb.width() <= 400 && thumb.height() <= 300);
        write(600, [20, 30, 220], later_time);
        assert_eq!(fs::metadata(&path).unwrap().len(), asset.bytes);
        let modified = card_source(&engine, &asset.id, true).unwrap();
        let updated = processed(&engine, &asset, &settings()).unwrap();
        assert_ne!(modified.source_version, first.source_version);
        assert_ne!(modified.path, first.path);
        assert_ne!(updated.key, encoded.key);
        // Keep the same timestamp: a length change must independently invalidate caches.
        write(604, [20, 30, 220], later_time);
        let resized = card_source(&engine, &asset.id, true).unwrap();
        assert_ne!(resized.source_version, modified.source_version);
        assert_eq!((resized.width, resized.height), (604, 400));
        assert_ne!(resized.path, modified.path);
    }
    #[test]
    fn avif_import_reads_container_dimensions() {
        let directory = tempfile::tempdir().unwrap();
        let asset = source_asset(directory.path());
        let mut config = settings();
        config.format = "avif".into();
        let (data, width, height, _) = encode(&asset, &config).unwrap();
        let path = directory.path().join("sample.avif");
        fs::write(&path, data).unwrap();
        let engine = Engine::new();
        let imported = import_one(&engine, &path, &path, false).unwrap();
        assert_eq!((imported.width, imported.height), (width, height));
        assert_eq!(fs::read_dir(engine.directory.path()).unwrap().count(), 0);
    }
    #[test]
    fn metadata_import_respects_exif_orientation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rotated.jpg");
        image::RgbImage::new(24, 16).save(&path).unwrap();
        let original = fs::read(&path).unwrap();
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut rotated = original[..2].to_vec();
        rotated.extend_from_slice(&[0xff, 0xe1]);
        rotated.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        rotated.extend_from_slice(exif);
        rotated.extend_from_slice(&original[2..]);
        fs::write(&path, rotated).unwrap();
        assert_eq!(source_info(&path).unwrap(), (16, 24, "jpg".into()));
        assert_eq!(decode(&path).unwrap().0.dimensions(), (16, 24));
    }
    #[test]
    fn gif_animation_check_skips_pixel_decoding() {
        let directory = tempfile::tempdir().unwrap();
        for frames in [1, 2] {
            let path = directory.path().join(format!("{frames}.gif"));
            {
                let mut encoder =
                    image::codecs::gif::GifEncoder::new(fs::File::create(&path).unwrap());
                for _ in 0..frames {
                    encoder
                        .encode_frame(image::Frame::new(image::RgbaImage::new(24, 16)))
                        .unwrap();
                }
            }
            if frames == 1 {
                assert!(source_info(&path).is_ok());
            } else {
                assert!(source_info(&path)
                    .unwrap_err()
                    .contains("Animation preservation"));
            }
        }
    }
    #[test]
    fn cpu_worker_policy() {
        for (threads, expected) in [
            (0, 1),
            (1, 1),
            (2, 1),
            (3, 2),
            (4, 3),
            (8, 7),
            (12, 11),
            (32, 31),
            (128, 64),
        ] {
            assert_eq!(worker_count_for_threads(threads), expected);
        }
    }
    #[test]
    fn encoder_threads_only_borrow_available_shared_cpu_slots() {
        let mut engine = Engine::new();
        engine.workers = Arc::new(tokio::sync::Semaphore::new(4));
        let base = engine.workers.clone().try_acquire_owned().unwrap();
        let occupied = engine.workers.clone().try_acquire_many_owned(2).unwrap();
        let (threads, extra) = encoder_slots(&engine, "avif", 8);
        assert_eq!(threads, 2);
        assert_eq!(engine.workers.available_permits(), 0);
        drop(extra);
        let (threads, extra) = encoder_slots(&engine, "png", 8);
        assert_eq!(threads, 1);
        assert!(extra.is_none());
        drop(occupied);
        drop(base);
        assert_eq!(engine.workers.available_permits(), 4);
    }
    #[test]
    fn simd_resize_preserves_alpha_edges_and_high_bit_depth() {
        let mut rgba = image::RgbaImage::new(2, 1);
        rgba.put_pixel(0, 0, image::Rgba([255, 0, 0, 0]));
        rgba.put_pixel(1, 0, image::Rgba([0, 0, 255, 255]));
        let resized = resize_image(&DynamicImage::ImageRgba8(rgba), 1, 1).unwrap();
        let pixel = resized.as_rgba8().unwrap().get_pixel(0, 0);
        assert!(pixel[0] <= 1 && pixel[2] >= 254);
        assert!((120..=135).contains(&pixel[3]));
        let source = DynamicImage::ImageLuma16(image::ImageBuffer::from_pixel(
            4,
            4,
            image::Luma([12345u16]),
        ));
        let resized = resize_image(&source, 2, 2).unwrap();
        assert_eq!(resized.color(), image::ColorType::L16);
        assert_eq!(resized.as_luma16().unwrap().get_pixel(0, 0)[0], 12345);
    }
    #[test]
    fn parallel_scan_keeps_order_reports_errors_and_skips_duplicates() {
        let directory = tempfile::tempdir().unwrap();
        let mut engine = Engine::new();
        engine.worker_count = 4;
        engine.workers = Arc::new(tokio::sync::Semaphore::new(4));
        let nested = directory.path().join("nested");
        fs::create_dir(&nested).unwrap();
        let mut paths = Vec::new();
        for index in 0..8 {
            let path = directory.path().join(format!("{index}.png"));
            image::RgbaImage::new(32, 24).save(&path).unwrap();
            paths.push(path.to_string_lossy().into_owned());
        }
        let invalid = directory.path().join("broken.jpg");
        fs::write(&invalid, b"unreadable image").unwrap();
        paths.insert(2, invalid.to_string_lossy().into_owned());
        paths.push(paths[0].clone());
        image::RgbaImage::new(32, 24)
            .save(nested.join("child.png"))
            .unwrap();
        paths.push(directory.path().to_string_lossy().into_owned());
        let delivered = Mutex::new(Vec::new());
        let results = scan_paths(&engine, paths, "scan-test", |item| {
            delivered.lock().unwrap().push(item.clone());
        });
        let names: Vec<_> = results
            .iter()
            .filter_map(|item| item.asset.as_ref())
            .map(|asset| asset.original_name.as_str())
            .collect();
        assert_eq!(
            names,
            vec![
                "0.png",
                "1.png",
                "2.png",
                "3.png",
                "4.png",
                "5.png",
                "6.png",
                "7.png",
                "child.png"
            ]
        );
        assert!(results[2].issue.as_ref().unwrap().contains("broken.jpg"));
        assert!(results[9]
            .issue
            .as_ref()
            .unwrap()
            .contains("duplicate skipped"));
        let child = results
            .iter()
            .filter_map(|item| item.asset.as_ref())
            .find(|asset| asset.original_name == "child.png")
            .unwrap();
        assert_eq!(child.relative_folder, "nested");
        assert_eq!(
            child.root_name,
            directory.path().file_name().unwrap().to_string_lossy()
        );
        assert_eq!(delivered.lock().unwrap().len(), results.len());
        assert!(results.iter().all(|item| item.request_id == "scan-test"));
        assert_eq!(engine.assets.lock().unwrap().len(), 9);
    }
    #[test]
    fn concurrent_import_reserves_source_once_and_failed_import_can_retry() {
        let directory = tempfile::tempdir().unwrap();
        let asset = source_asset(directory.path());
        let path = PathBuf::from(asset.source_path);
        let engine = Engine::new();
        let barrier = std::sync::Barrier::new(4);
        let successes = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        barrier.wait();
                        import_one(&engine, &path, &path, false).is_ok()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .filter(|success| *success)
                .count()
        });
        assert_eq!(successes, 1);
        assert_eq!(engine.assets.lock().unwrap().len(), 1);
        let retry = directory.path().join("retry.png");
        fs::write(&retry, b"broken").unwrap();
        assert!(import_one(&engine, &retry, &retry, false).is_err());
        image::RgbaImage::new(16, 16).save(&retry).unwrap();
        assert!(import_one(&engine, &retry, &retry, false).is_ok());
    }
    #[test]
    #[ignore = "Set PIXFORGE_TEST_IMAGE to a local image to diagnose import"]
    fn imports_external_image() {
        let path =
            PathBuf::from(std::env::var("PIXFORGE_TEST_IMAGE").expect("Set PIXFORGE_TEST_IMAGE"));
        let engine = Engine::new();
        let asset = import_one(&engine, &path, &path, false).expect("Image import failed");
        assert!(asset.width > 0 && asset.height > 0);
        assert!(Path::new(&asset.thumbnail).is_file());
        println!(
            "Imported {}: {}x{}, {}",
            asset.original_name, asset.width, asset.height, asset.format
        );
    }
    fn source_asset(directory: &Path) -> Asset {
        let path = directory.join("source.png");
        image::RgbaImage::from_fn(24, 16, |x, y| {
            image::Rgba([x as u8 * 10, y as u8 * 15, 120, 180])
        })
        .save(&path)
        .unwrap();
        Asset {
            id: "test-source".into(),
            source_path: path.to_string_lossy().into_owned(),
            relative_folder: String::new(),
            root_id: String::new(),
            root_name: String::new(),
            original_name: "source.png".into(),
            stem: "source".into(),
            format: "png".into(),
            width: 24,
            height: 16,
            bytes: fs::metadata(path).unwrap().len(),
            thumbnail: String::new(),
            source_version: String::new(),
            excluded: false,
        }
    }
    #[test]
    fn native_formats_encode_and_decode_with_expected_dimensions() {
        let directory = tempfile::tempdir().unwrap();
        let asset = source_asset(directory.path());
        for format in ["webp", "avif", "jpg", "jpeg", "png"] {
            let mut config = settings();
            config.format = format.into();
            config.max_width = "12".into();
            let (data, width, height, output_format) = encode(&asset, &config).unwrap();
            assert_eq!((width, height), (12, 8));
            assert_eq!(output_format, format);
            let decoded = image::load_from_memory(&data).unwrap();
            assert_eq!(decoded.dimensions(), (12, 8), "{format}");
        }
    }
    #[test]
    fn native_passthrough_preserves_original_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let asset = source_asset(directory.path());
        let mut config = settings();
        config.format = "original".into();
        let (data, width, height, _) = encode(&asset, &config).unwrap();
        assert_eq!((width, height), (24, 16));
        assert_eq!(data, fs::read(&asset.source_path).unwrap());
    }
    fn settings() -> Settings {
        Settings {
            format: "webp".into(),
            quality: 80,
            resize: true,
            max_width: "800".into(),
            max_height: "600".into(),
            upscale: false,
            compress_original: false,
            png_compression: "balanced".into(),
            background: "#ffffff".into(),
        }
    }
    #[test]
    fn aspect_ratio() {
        assert_eq!(
            target_dimensions(2400, 1200, &settings()).unwrap(),
            (800, 400)
        );
        assert_eq!(
            target_dimensions(400, 200, &settings()).unwrap(),
            (400, 200)
        );
    }
    #[test]
    fn rejects_unsafe_names() {
        for name in ["../escape", "CON", "a/b", "", "trailing.", "LPT1.jpg"] {
            assert!(validate_component(name).is_err(), "{name}");
        }
        assert!(validate_component("夏の写真-001").is_ok());
    }
    #[test]
    fn refuses_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        assert!(ensure_directory(dir.path(), Path::new("../escape")).is_err());
    }
}
