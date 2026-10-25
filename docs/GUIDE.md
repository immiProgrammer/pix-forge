# Detailed PixForge guide

Prepare product images for your store, on your own machine.

PixForge renames, resizes, compresses, and converts images for ecommerce stores. Drop in a folder of product photos, choose your settings, and compare the result before you export. The desktop app processes images in Rust.

A 5000 px photo often needs resizing before it goes on a product page. A filename like `IMG_4821.jpg` needs attention too. PixForge handles both in one batch, without uploading your photos or asking you to create an account.

## Workspace and quick start

This repository uses **pnpm workspaces and Turborepo**. Use Node.js 22.12+ (Node 24 recommended) and the pinned pnpm version in `package.json`.

```powershell
pnpm install
pnpm dev:web       # Landing site: http://localhost:5174
pnpm dev:desktop   # Desktop UI in a browser: http://localhost:5173
pnpm dev           # Both Vite apps
pnpm tauri dev     # Native desktop window with hot reload
```

| Location                     | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `apps/desktop`               | Existing React/TypeScript workbench and `src-tauri` Rust engine |
| `apps/web`                   | Independent Vite React/TypeScript landing site                  |
| `packages/typescript-config` | Shared strict React/TypeScript configuration                    |
| `scripts`                    | Root native launchers, Windows packaging, release validation    |

`pnpm build`, `pnpm test`, and `pnpm check-types` run through Turbo. Use `pnpm build:web` or `pnpm build:desktop` to build one app. Static outputs are `apps/web/dist` and `apps/desktop/dist`; Windows installers remain available through `pnpm dist:windows`.

The landing site's theme tokens live separately in `apps/web/src/theme.css`, with the same neutral colors and muted green as the desktop app. It supports Light, Dark, and System preferences. See [the website guide](../apps/web/README.md) for deployment and release links.

## What you can do

- Rename images from their folder name or a custom product name, with numbered filenames. Edit individual names by hand. For image SEO, use descriptive names such as `linen-summer-shirt-001.webp`.
- Clean up existing names into lowercase words separated by hyphens. Names can include Unicode characters.
- Set maximum width and height. PixForge keeps the aspect ratio and leaves smaller images alone when upscaling is off.
- Adjust quality and compression. Export WebP, AVIF, JPEG, or PNG, or keep the original format.
- Import nested folders and work in a grid or list. Rename all images or a selection, lock names against batch changes, and undo naming edits.
- Generate an AI renaming prompt and import a reviewed JSON path-to-name mapping from any AI tool, without connecting an AI account to PixForge.

## Import and select images

Add multiple images, multiple folders, or a mixture through the picker or drag and drop. Folder scans are recursive, imports append to the current session, and repeated source files are detected. Cards appear as file metadata is read. In the desktop app, rendered cards load source images immediately, including nearby rows prepared ahead of scrolling; unsupported image display uses a small on-demand fallback. Scrolling a card outside the viewport does not clear its image or restart its request. Large collections still use row virtualization. While importing, up to three loading cards appear after the existing images in the same grid/list; choosing one or two files shows only that many placeholders. Placeholders are not selectable. The status bar also shows scanning activity, and skipped or unreadable files have notices you can review.

Both workspace views share selection and filenames. The toolbar's Fit/Fill control sets how images appear in cards: Fit shows the entire image, while Fill crops the edges to cover the preview box. This preference is saved and does not affect processed or exported images. Click to select, Ctrl/Cmd-click to toggle, Shift-click for a range, or drag a rectangle across cards to select overlapping images. Ctrl/Cmd+A selects all imported images; arrow keys move selection, Enter opens comparison, and Delete removes selected images from the session. Filename inputs and controls do not start rectangle selection. Drag selection scrolls at the edges, and large collections render only nearby rows.

Each card shows the source dimensions, format, and size; processed results show the actual output size and reduction. Output filename stems are editable, while extensions follow the chosen format automatically. Hover or focus a card to process that image with the small play button, or use the exclusion control to protect its name from batch actions.

Importing files and selecting images alone do not start processed previews. Import updates are batched to keep the interface responsive. Changing an output setting previews the images selected at that moment. When fewer than three are selected, the first three images are also previewed as a sample; with three or more selected, the sample is skipped. Preview targets are captured when settings change, so adding more files does not expand that processing batch. The image open in comparison is always previewed. Export applies the current settings to every image in the chosen export scope.

## Naming and AI rename

Naming tools are actions with explicit All images or Selected images scope:

- **Folder name + index** uses each image's immediate parent folder and restarts numbering within that folder.
- **Custom name + index** uses one sequence across the target images. Press Enter in its input to run it.
- **Slugify current names** makes Unicode-safe, lowercase, hyphen-separated stems while removing unsafe filename characters.

Choose the starting index, padding, and separator. Manual edits remain until another action changes them; they do not automatically exclude an image. Excluded images remain directly editable. Manual name edits, exclusion changes, and each whole batch operation have Undo/Redo history. A new change after Undo clears the redo branch.

The **AI rename** button opens a two-step dialog. Choose folder-based naming or an optional custom product name; leave the custom name blank to clean up individual existing names. Add optional instructions, then copy the generated prompt into an AI tool. The default instructions preserve meaningful product sizes, colors, models, and variants, remove capture noise such as WhatsApp/Screenshot and unrelated dates, and slugify unless your instructions request a different format. The prompt contains names and folder paths, not image uploads.

Paste the response into **Import mapping**:

```json
{
  "catalog/shoes/WhatsApp-red-size-42.png": "running-shoes-red-size-42",
  "catalog/shoes/Screenshot-blue-size-40.jpg": "running-shoes-blue-size-40"
}
```

Keys match original source paths exactly; values are new filename stems without extensions. JSON order does not matter, and missing paths stay unchanged. The dialog reviews changes in workspace order and rejects unknown paths, duplicate keys, non-string values, invalid names, and output collisions with other images. Excluded images are omitted. Applying the mapping creates one undoable naming operation. See the [AI rename guide](AI-RENAME.md) for details.

## Conversion settings

Choose WebP, AVIF, JPG, JPEG, PNG, or **Keep source format**. JPG and JPEG share an encoder; the choice controls the extension. The quality slider runs from 0 to 100, with higher values favoring quality. PNG has separate lossless compression settings. JPEG output composites transparency against a chosen background color, defaulting to white.

Optional maximum width and height fit images within a bounding box while preserving aspect ratio. A blank dimension is unlimited, and upscaling is disabled by default. Image orientation is applied before dimensions are calculated. Keep source format retains each image's format; when no effective resizing or recompression is requested, export copies the original bytes.

## Check the result before exporting

Double-click an image to open comparison mode. Use the slider or side-by-side view to inspect the original and output. Both views share zoom and pan, so you can check the same product detail in each.

Change quality, format, or dimensions while the comparison is open. The preview shows the actual encoded file size. The desktop app uses the same Rust encoding function for comparison and export. Supported originals display directly without converting to PNG; formats the WebView cannot decode use a full-resolution Rust fallback. Opening or navigating comparison starts processing immediately, while setting changes remain debounced. A single decoded source is retained up to 128 MB and reused across quality changes, with source modification time and file size invalidating it. Obsolete requests stop between decoding, resizing, and encoding; an encoder already running must finish.

Compression can make a file larger. Check the size difference alongside the image, especially when changing formats.

Comparison replaces the file viewport rather than opening a modal, so output settings remain accessible. Its toolbar matches the file toolbar. Source/output sizes and dimensions appear around an arrow beside the reduction below the image. Mouse-wheel zoom, drag-to-pan, Fit, 100%, Reset, and previous/next navigation are available. Images remain draggable even when smaller than the viewport; zoom-out brings images extending beyond it back toward the center. The slider divider has its own drag target, separate from image panning.

When opening or navigating to an image, both comparison sides stay hidden behind a loading indicator until both images are decoded, then appear together. During re-encoding, the previous completed pair stays visible with a centered loading indicator. Statistics wait for the actual current encoded result. Byte reduction is `(original bytes - output bytes) / original bytes × 100`; larger results are reported as a size increase. A reduced thumbnail is never presented as the final output size.

## Export without overwriting your originals

Choose a destination and review the output paths. PixForge preserves the folder structure and protects imported source files from overwrite. If an output filename already exists, you can add a suffix, skip it, or replace it.

After export, the report shows file sizes and reductions by image, folder, and batch. Skipped and failed files do not count toward the savings. You can retry failed files.

Export all images or selected images into an existing destination, optionally creating a subfolder. Multiple imported roots retain their folder names; duplicate root names require explicit aliases. Preflight checks cover destination access, unsafe or empty names, duplicate output paths, existing files, and source-file overwrite protection. **Add suffix** is the safe default; **Skip** and **Replace** are also available. Progress includes completed/failed counts and cancellation. Cancellation keeps finished files and cleans up incomplete temporary files. Afterward, open the output folder or retry failures. Batch reduction is calculated from the total bytes of successfully exported source/output pairs.

## Desktop controls and themes

The custom titlebar provides minimize, maximize/restore, close, and Help & keyboard shortcuts. The workspace uses one toolbar and one bottom status bar. The sidebar toggle sits at the far-right edge beside the output settings panel. Below Tailwind's `lg` breakpoint (1024 px), settings open in a floating Base UI sheet.

Light, Dark, and System themes persist locally; System follows operating-system changes. Surfaces use neutral black/white/gray with muted green as the primary accent. Native window, WebView, and page backgrounds follow the active theme to avoid white exposure during resizing. Base UI selects, checkboxes, switches, dialogs, and popovers share the theme. The whole theme button opens its menu, which aligns to the right edge.

Keyboard focus is visible, controls have accessible names, transparency uses checkerboards, and status information includes text/icons. Interface labels are non-selectable; filename inputs, paths, error details, prompt text, and result values remain selectable for editing or copying.

## Try it with a product folder

1. Drop in a product folder, such as `Linen Summer Shirt`, containing your original photos.
2. Rename from the folder name to create names such as `linen-summer-shirt-001.webp`. You can also use a custom name or edit filenames individually.
3. Choose an output format and quality. The default is WebP at quality 80.
4. Enable resizing and set maximum width and height to `2000`. A `5000 × 3500` image becomes `2000 × 1400`. Smaller images keep their dimensions when upscaling is off.
5. Open comparison mode and check the product details, image quality, and encoded file size.
6. Review the export plan, choose a destination, and export your images for upload to your store.

To rename without changing the image data, keep the original format and turn off resizing and recompression. PixForge copies the original bytes.

## Everything stays on your machine

PixForge processes your photos locally. It saves settings and view preferences on your machine, and bundles its fonts with the app.

Upload the exported files through your store's usual tools. PixForge does not connect to your storefront. When you restart the app, you need to import your images again.

## Supported formats and limits

The desktop app imports still JPEG, PNG, WebP, AVIF, GIF, BMP, and TIFF images. Output choices are WebP, AVIF, JPEG, PNG, and original format.

- PixForge rejects animated GIF, WebP, APNG, and AVIF inputs.
- PNG compression is lossless for integer channel samples. Floating-point inputs must be quantized to 16-bit for PNG output.
- Re-encoding does not preserve metadata or color profiles. Original-byte passthrough retains them.
- Each input file must be no larger than 512 MB. Resized output must be no larger than 64 megapixels.

## Run locally

### Desktop app

The desktop app uses React, TypeScript, Tauri 2, and Rust. Install Node.js with npm, a stable Rust toolchain, and the native dependencies for your platform.

For Windows prerequisites, native codec setup, and installer instructions, follow the [Windows build guide](WINDOWS-BUILD.md).

From the project directory:

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

The native AVIF decoder requires dav1d development libraries with pkg-config metadata available to Cargo. AVIF encoding can also require NASM. Linux and macOS builds need the appropriate Tauri system dependencies; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

On Windows, the launcher prepares Rust, MSVC, NASM, and dav1d/pkgconf paths automatically after the prerequisites are installed. It uses `C:\Dev\vcpkg` or a configured codec installation. The first build can take several minutes; later launches use cached dependencies and hot reload.

### Browser development

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

The browser version supports local imports, folder drops, naming, resizing, comparison, and WebP/JPEG/PNG encoding. Folder export requires a browser with the File System Access API. AVIF encoding depends on browser support; unsupported encoding returns an error. GIF import, TIFF import, and encoder-specific lossless PNG compression require the desktop app.

The native Tauri window uses Rust for both processed previews and export. Opening the same Vite URL in a regular browser uses Canvas encoding for both; results can differ from the desktop encoders. Browser mode is useful for interface development and a limited local web workflow.

## Build

Build the frontend:

```sh
pnpm build
```

Build the desktop app after installing native prerequisites:

```sh
pnpm tauri build
```

Windows packaging shortcuts:

```powershell
pnpm dist:exe      # NSIS installer
pnpm dist:msi      # MSI installer
pnpm dist:windows  # Both installers
pnpm dist:app      # Standalone executable
```

See the [Windows build guide](WINDOWS-BUILD.md) for output locations and runtime requirements. A frontend build alone does not produce a desktop executable.

### GitHub Releases

The **Check** workflow runs frontend checks and Linux native tests. **Windows installers** runs on pull requests, pushes to `master`/`main`, or manually; it tests the app and uploads EXE/MSI installers as downloadable Actions artifacts without publishing a release. Windows build checks and releases share the same native dependency setup.

The **Release Windows** workflow builds Windows x64 EXE/MSI installers and checksums, then publishes them to GitHub Releases when a matching version tag such as `v0.1.0` is pushed. It can also be run manually for an existing tag. Tests run before packaging; failed builds do not publish a release. See the [release guide](RELEASING.md) for version updates, triggering, retries, and signing limitations.

## Development

Run the frontend tests and production build:

```sh
pnpm test
pnpm build
```

Run native tests with the Rust toolchain and system libraries installed:

```sh
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Format source files:

```sh
pnpm format
```

Main source files:

- [`apps/desktop/src/model.ts`](../apps/desktop/src/model.ts): naming, resizing, validation, and undo/redo history.
- [`apps/desktop/src/bridge.ts`](../apps/desktop/src/bridge.ts): desktop IPC and browser processing fallback.
- [`apps/desktop/src/Workspace.tsx`](../apps/desktop/src/Workspace.tsx): image grid, list, selection, and manual naming.
- [`apps/desktop/src/Compare.tsx`](../apps/desktop/src/Compare.tsx): original/output comparison.
- [`apps/desktop/src/AiRename.tsx`](../apps/desktop/src/AiRename.tsx) and [`apps/desktop/src/ai-renaming.ts`](../apps/desktop/src/ai-renaming.ts): prompt generation, path mapping validation, and change review.
- [`apps/desktop/src-tauri/src/lib.rs`](../apps/desktop/src-tauri/src/lib.rs): native scanning, decoding, thumbnails, caching, and encoding.
- [`apps/desktop/src-tauri/src/export.rs`](../apps/desktop/src-tauri/src/export.rs): export validation, collision handling, source protection, and atomic writes.

The engine uses stable source IDs independent of output filenames, a shared background-worker ceiling based on detected logical CPU threads (one thread reserved for responsiveness, up to 64 concurrent images), on-demand fallback/processed caches, debounced previews, and cancellation of obsolete requests. Filenames and settings are an export plan; filesystem changes happen only during export. Native imports read metadata in bounded parallel batches while keeping discovery order, without decoding source pixels or generating thumbnails up front. Card fallback and processed caches include the canonical source ID, modification time, file size, and processing settings. Source metadata is checked again when a card image is requested or an image is processed; changed dimensions and sizes are refreshed. This is cache revalidation, not folder watching. Imports, previews, and export encoding share the same worker limit. Exports use a continuous queue: each worker processes and commits one image before taking the next, without retaining batches of encoded images in memory. Export reserves working memory separately for each image, rechecks free RAM and process memory every 500 ms, and admits smaller images that fit beside larger ones. Saved Low memory, Balanced, and Maximum speed presets provide automatic RAM/CPU budgets, with optional worker and RAM limits in the settings panel. This is a scheduling estimate, not a strict memory allocation limit. Collision paths are reserved in input order; files complete independently and the final report is sorted into input order. Cached encoded previews and unchanged originals stream to temporary output files. Resizing and JPEG encoding automatically use supported SIMD CPU instructions; WebP and AVIF use faster encoding effort while preserving the chosen quality value. See [performance behavior and benchmark instructions](PERFORMANCE.md). Import returns a completed batch as well as progressive events, so the UI reconciles any final events still in flight.

Frontend tests cover naming/history, mapping validation, preview targeting, virtual selection geometry, import delivery, export collisions/cancellation, and byte totals. Native smoke tests cover dimensions, safe paths, source-byte passthrough, and WebP/AVIF/JPEG/PNG encoding and decoding. To diagnose a particular local file without adding it to the repository, set `PIXFORGE_TEST_IMAGE` and run the ignored `imports_external_image` native test. Full native export and installer packaging still need release smoke tests.

Cloud accounts, automatic AI connections, uploads, cropping, watermarking, and folder watching are outside the first-release scope.

## Contributing

For image-processing bugs, include the input format, dimensions, output settings, and steps to reproduce the problem. Run the relevant checks above when changing code.

## License

This repository does not yet include a license. It needs an open-source license before release as open-source software.
