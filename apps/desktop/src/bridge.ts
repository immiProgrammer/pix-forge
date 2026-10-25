import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  dimensions,
  extension,
  outputPath,
  settingsKey,
  validatePlan,
  invalidStem,
} from "./model";
import type { Asset, Processed, Settings } from "./model";
import type { ExportedImage } from "./export-report";
import { defaultPerformance, normalizePerformance } from "./performance";
import type { PerformanceOptions } from "./performance";
export const desktop = isTauri();
export type CardSource = Pick<
  Asset,
  "width" | "height" | "bytes" | "format" | "sourceVersion"
> & { url: string };
function versionedSource(path: string, version?: string) {
  const url = convertFileSrc(path);
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}
export async function cardImage(
  asset: Asset,
  fallback: boolean,
  signal: AbortSignal,
): Promise<CardSource> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (!desktop)
    return {
      url: asset.thumbnail,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
      format: asset.format,
      sourceVersion: asset.sourceVersion,
    };
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void invoke("cancel_export", { jobId: requestId });
  };
  signal.addEventListener("abort", cancel);
  try {
    const result = await invoke<Omit<CardSource, "url"> & { path: string }>(
      "card_image",
      { id: asset.id, fallback, requestId },
    );
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return {
      ...result,
      url: versionedSource(result.path, result.sourceVersion),
    };
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
export async function forgetAssets(ids: string[]) {
  if (desktop) await invoke("forget_images", { ids });
}
export interface Progress {
  completed: number;
  failed: number;
  skipped?: number;
  total: number;
  current: string;
  done?: boolean;
  cancelled?: boolean;
  failedIds?: string[];
  failures?: Record<string, string>;
  outputs?: ExportedImage[];
}
export type Collision = "suffix" | "skip" | "replace";
let browserDestination: FileSystemDirectoryHandle | undefined;
export async function chooseInput(folder: boolean) {
  const result = await open({
    directory: folder,
    multiple: true,
    ...(!folder
      ? {
          filters: [
            {
              name: "Images",
              extensions: [
                "jpg",
                "jpeg",
                "png",
                "webp",
                "avif",
                "gif",
                "bmp",
                "tif",
                "tiff",
              ],
            },
          ],
        }
      : {}),
  });
  return result ? (Array.isArray(result) ? result : [result]) : [];
}
export async function scan(
  paths: string[],
  onAsset: (a: Asset) => void,
  onIssue: (s: string) => void,
  onSettled: () => void = () => {},
) {
  const requestId = crypto.randomUUID();
  type ScanItem = {
    requestId: string;
    asset?: Asset;
    issue?: string;
  };
  const handled = new Set<string>();
  const receive = (p: ScanItem) => {
    if (p.requestId !== requestId) return;
    const key = p.asset ? `asset:${p.asset.id}` : `issue:${p.issue}`;
    if (handled.has(key)) return;
    handled.add(key);
    if (p.asset)
      onAsset({
        ...p.asset,
        thumbnail: versionedSource(p.asset.thumbnail, p.asset.sourceVersion),
      });
    if (p.issue) onIssue(p.issue);
    onSettled();
  };
  const unlisten = await listen<ScanItem>("scan-item", ({ payload }) =>
    receive(payload),
  );
  try {
    const completed = await invoke<ScanItem[]>("scan_images", {
      paths,
      requestId,
    });
    for (const item of completed ?? []) receive(item);
  } finally {
    unlisten();
  }
}
export async function browserImport(
  files: File[],
  onAsset: (a: Asset) => void,
  onIssue: (s: string) => void,
  onSettled: () => void = () => {},
) {
  for (const file of files) {
    try {
      if (!/\.(png|jpe?g|webp|avif|bmp|gif)$/i.test(file.name))
        throw new Error("Unsupported image format");
      const buffer = new Uint8Array(await file.arrayBuffer());
      const header = new TextDecoder("latin1").decode(buffer);
      if (
        header.includes("acTL") ||
        header.includes("ANIM") ||
        header.slice(0, 64).includes("avis") ||
        /\.gif$/i.test(file.name)
      )
        throw new Error(
          "Animation preservation is unsupported. Import a still PNG, JPEG, WebP, AVIF, or BMP.",
        );
      const image = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 400 / image.width, 300 / image.height);
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const path = file.webkitRelativePath || file.name;
      const parts = path.split("/");
      const rootName = parts.length > 1 ? parts.shift()! : "";
      const originalName = parts.pop()!;
      const folder = parts.join("/");
      const format = file.name.split(".").pop()!.toLowerCase();
      onAsset({
        id: `browser:${path}:${file.size}:${file.lastModified}`,
        sourcePath: path,
        relativeFolder: folder,
        rootId: rootName || "loose-files",
        rootName,
        originalName,
        stem: originalName.replace(/\.[^.]+$/, ""),
        format,
        width: image.width,
        height: image.height,
        bytes: file.size,
        thumbnail: canvas.toDataURL("image/webp", 0.8),
        excluded: false,
        file,
      });
      image.close();
    } catch (e) {
      onIssue(`${file.name}: ${e instanceof Error ? e.message : e}`);
    } finally {
      onSettled();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
export async function processAsset(
  asset: Asset,
  settings: Settings,
  signal?: AbortSignal,
): Promise<Processed> {
  const key = `${asset.id}:${settingsKey(settings)}`;
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (desktop) {
    const requestId = crypto.randomUUID();
    const cancel = () => {
      void invoke("cancel_export", { jobId: requestId });
    };
    signal?.addEventListener("abort", cancel);
    try {
      const result = await invoke<Omit<Processed, "url">>("process_image", {
        id: asset.id,
        settings,
        requestId,
      });
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      return { ...result, key, url: convertFileSrc(result.cachePath!) };
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  if (!asset.file) throw new Error("Source unavailable");
  const format = extension(asset, settings);
  const d = dimensions(asset.width, asset.height, settings);
  if (d.width * d.height > 64_000_000)
    throw new Error("Output exceeds the 64 megapixel processing limit");
  if (
    settings.format === "original" &&
    !settings.compressOriginal &&
    d.width === asset.width &&
    d.height === asset.height
  )
    return {
      key,
      url: URL.createObjectURL(asset.file),
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      format,
      blob: asset.file,
    };
  const image = await createImageBitmap(asset.file);
  if (signal?.aborted) {
    image.close();
    throw new DOMException("Cancelled", "AbortError");
  }
  const canvas = document.createElement("canvas");
  canvas.width = d.width;
  canvas.height = d.height;
  const ctx = canvas.getContext("2d")!;
  if (format === "jpg" || format === "jpeg") {
    ctx.fillStyle = settings.background;
    ctx.fillRect(0, 0, d.width, d.height);
  }
  ctx.drawImage(image, 0, 0, d.width, d.height);
  image.close();
  const mime = `image/${format === "jpg" ? "jpeg" : format}`;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encoding failed"))),
      mime,
      settings.quality / 100,
    ),
  );
  if (blob.type !== mime)
    throw new Error(
      `${format.toUpperCase()} encoding requires the desktop app on this browser.`,
    );
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  return {
    key,
    url: URL.createObjectURL(blob),
    bytes: blob.size,
    ...d,
    format,
    blob,
  };
}
export async function originalPreview(asset: Asset): Promise<string> {
  if (!desktop)
    return asset.file ? URL.createObjectURL(asset.file) : asset.thumbnail;
  if (!/^(tif|tiff)$/i.test(asset.format)) {
    const url = versionedSource(asset.sourcePath, asset.sourceVersion);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      return url;
    } catch {
      // Use Rust only when the WebView cannot decode the source format.
    }
  }
  const result = await invoke<Processed>("source_preview", { id: asset.id });
  return convertFileSrc(result.cachePath!);
}
export function dispose(result: Processed) {
  if (result.url.startsWith("blob:")) URL.revokeObjectURL(result.url);
}
export async function chooseDestination(): Promise<string | undefined> {
  if (desktop) {
    const path = await open({ directory: true, multiple: false });
    return typeof path === "string" ? path : undefined;
  }
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (o: {
        mode: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker)
    throw new Error(
      "Folder export needs the desktop app or a browser with the File System Access API (Chrome or Edge).",
    );
  browserDestination = await picker({ mode: "readwrite" });
  return browserDestination.name;
}
export async function revealDestination(path: string) {
  if (desktop) await openPath(path);
}
export async function exportAssets(
  assets: Asset[],
  settings: Settings,
  destination: string,
  subfolder: string,
  roots: Record<string, string>,
  collision: Collision,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
  sources: Asset[] = assets,
  performance: PerformanceOptions = defaultPerformance,
) {
  if (desktop) {
    const jobId = crypto.randomUUID();
    const unlisten = await listen<Progress & { jobId: string }>(
      "export-progress",
      ({ payload }) => {
        if (payload.jobId === jobId) onProgress(payload);
      },
    );
    const cancel = () => {
      void invoke("cancel_export", { jobId });
    };
    signal.addEventListener("abort", cancel);
    try {
      return await invoke<Progress>("export_images", {
        jobId,
        ids: assets.map((a) => a.id),
        names: Object.fromEntries(assets.map((a) => [a.id, a.stem])),
        settings,
        destination,
        subfolder,
        roots,
        collision,
        performance: normalizePerformance(performance),
      });
    } finally {
      unlisten();
      signal.removeEventListener("abort", cancel);
    }
  }
  if (!browserDestination) throw new Error("Choose an output folder first");
  const invalid = validatePlan(assets, settings, roots);
  if (subfolder && invalidStem(subfolder))
    invalid.push("Invalid output folder name");
  if (invalid.length) throw new Error(invalid.join("\n"));
  let completed = 0,
    failed = 0,
    skipped = 0;
  const failedIds: string[] = [];
  const failures: Record<string, string> = {};
  const used = new Set<string>();
  const outputs: ExportedImage[] = [];
  for (const asset of assets) {
    if (signal.aborted) break;
    let processed: Processed | undefined;
    try {
      let dir = browserDestination;
      const parts = [subfolder, outputPath(asset, settings, roots)]
        .filter(Boolean)
        .join("/")
        .split("/");
      let name = parts.pop()!;
      for (const part of parts)
        dir = await dir.getDirectoryHandle(part, { create: true });
      const exists = async (n: string) => {
        if (used.has([...parts, n].join("/").toLocaleLowerCase())) return true;
        try {
          await dir.getFileHandle(n);
          return true;
        } catch (e) {
          if ((e as DOMException).name !== "NotFoundError") throw e;
          return false;
        }
      };
      if (await exists(name)) {
        if (collision === "skip") {
          skipped++;
          onProgress({
            completed,
            failed,
            skipped,
            total: assets.length,
            current: `Skipped ${name}`,
          });
          continue;
        }
        if (collision === "suffix") {
          const base = name.replace(/\.[^.]+$/, ""),
            ext = name.split(".").pop();
          let n = 1;
          while (await exists(name)) name = `${base}-${n++}.${ext}`;
        } else if (used.has([...parts, name].join("/").toLocaleLowerCase()))
          throw new Error("Two planned images cannot replace the same path");
      }
      processed = await processAsset(asset, settings, signal);
      if (signal.aborted) break;
      const existed = await exists(name);
      const handle = await dir.getFileHandle(name, { create: true });
      if (collision === "replace") {
        const existing = await handle.getFile();
        if (
          sources.some(
            (a) =>
              a.file &&
              a.file.name === existing.name &&
              a.file.size === existing.size &&
              a.file.lastModified === existing.lastModified,
          )
        )
          throw new Error(
            "Cannot replace an imported source file. Choose Add suffix or another folder.",
          );
      }
      let writer: FileSystemWritableFileStream | undefined;
      try {
        writer = await handle.createWritable();
        await writer.write(processed.blob!);
        if (signal.aborted) {
          await writer.abort();
          if (!existed) await dir.removeEntry(name);
          break;
        }
        await writer.close();
      } catch (e) {
        await writer?.abort();
        if (!existed) await dir.removeEntry(name);
        throw e;
      }
      used.add([...parts, name].join("/").toLocaleLowerCase());
      outputs.push({
        id: asset.id,
        inputPath: asset.sourcePath,
        outputPath: [...parts, name].join("/"),
        inputBytes: asset.file?.size ?? asset.bytes,
        outputBytes: (await handle.getFile()).size,
      });
      completed++;
    } catch (e) {
      if (signal.aborted) break;
      failed++;
      failedIds.push(asset.id);
      failures[asset.id] = String(e);
    } finally {
      if (processed) dispose(processed);
    }
    onProgress({
      completed,
      failed,
      skipped,
      total: assets.length,
      current: asset.originalName,
    });
  }
  return {
    completed,
    failed,
    skipped,
    total: assets.length,
    current: "",
    done: true,
    cancelled: signal.aborted,
    failedIds,
    failures,
    outputs,
  };
}
export async function droppedFiles(data: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  async function read(entry: FileSystemEntry, prefix = "") {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      Object.defineProperty(file, "webkitRelativePath", {
        value: prefix + file.name,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const entries = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        for (const child of entries)
          await read(child, `${prefix}${entry.name}/`);
      }
    }
  }
  const entries = Array.from(data.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const entry of entries) await read(entry);
  else files.push(...data.files);
  return files;
}
