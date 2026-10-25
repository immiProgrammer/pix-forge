export type Format = "webp" | "avif" | "jpg" | "jpeg" | "png" | "original";
export interface Settings {
  format: Format;
  quality: number;
  resize: boolean;
  maxWidth: string;
  maxHeight: string;
  upscale: boolean;
  compressOriginal: boolean;
  pngCompression: "fast" | "balanced" | "best";
  background: string;
}
export const defaultSettings: Settings = {
  format: "webp",
  quality: 80,
  resize: false,
  maxWidth: "",
  maxHeight: "",
  upscale: false,
  compressOriginal: false,
  pngCompression: "balanced",
  background: "#ffffff",
};
export interface Asset {
  id: string;
  sourcePath: string;
  relativeFolder: string;
  rootId: string;
  rootName: string;
  originalName: string;
  stem: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  thumbnail: string;
  sourceVersion?: string;
  excluded: boolean;
  file?: File;
}
export interface Processed {
  url: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  blob?: Blob;
  cachePath?: string;
  key: string;
  sourceVersion?: string;
}
export interface NamingEntry {
  id: string;
  stem: string;
  excluded: boolean;
}
export interface History {
  past: NamingEntry[][];
  future: NamingEntry[][];
}
export type NamingAction = "folder" | "custom" | "slug";
export interface NamingOptions {
  start: number;
  padding: number;
  separator: string;
  custom: string;
}
export function snapshot(assets: Asset[]): NamingEntry[] {
  return assets.map(({ id, stem, excluded }) => ({ id, stem, excluded }));
}
export function restore(assets: Asset[], names: NamingEntry[]) {
  const map = new Map(names.map((n) => [n.id, n]));
  return assets.map((a) => ({ ...a, ...map.get(a.id) }));
}
export function slugify(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .trim()
    .replace(/[\s_-]+/gu, "-")
    .replace(/^-|-$/g, "");
}
export function invalidStem(stem: string): string | undefined {
  if (!stem.trim()) return "Filename cannot be empty";
  if (
    stem !== stem.trim() ||
    /[<>:"/\\|?*\x00-\x1f]/.test(stem) ||
    /[. ]$/.test(stem) ||
    stem === "." ||
    stem === ".."
  )
    return "Filename contains unsafe characters";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))
    return "Reserved system filename";
  if (new TextEncoder().encode(stem).length > 240)
    return "Filename is too long";
}
export function extension(asset: Asset, settings: Settings) {
  return settings.format === "original" ? asset.format : settings.format;
}
export function dimensions(width: number, height: number, settings: Settings) {
  if (!settings.resize) return { width, height };
  const w = Number(settings.maxWidth) || Infinity,
    h = Number(settings.maxHeight) || Infinity;
  let ratio = Math.min(w / width, h / height);
  if (!settings.upscale) ratio = Math.min(1, ratio);
  if (!Number.isFinite(ratio)) ratio = 1;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
export function rename(
  assets: Asset[],
  target: Set<string>,
  action: NamingAction,
  options: NamingOptions,
) {
  let index = options.start;
  const folders = new Map<string, number>();
  return assets.map((a) => {
    if (!target.has(a.id) || a.excluded) return a;
    let stem = a.stem;
    if (action === "slug") stem = slugify(stem);
    else {
      const folder =
        a.relativeFolder.split("/").filter(Boolean).at(-1) ||
        a.rootName ||
        a.sourcePath.replaceAll("\\", "/").split("/").at(-2) ||
        "image";
      const group = a.rootName
        ? `${a.rootId}/${a.relativeFolder}`
        : a.sourcePath.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
      const n =
        action === "folder" ? (folders.get(group) ?? options.start) : index++;
      if (action === "folder") folders.set(group, n + 1);
      stem = `${action === "folder" ? slugify(folder) : options.custom.trim()}${options.separator}${String(n).padStart(options.padding, "0")}`;
    }
    return { ...a, stem };
  });
}
export function outputPath(
  asset: Asset,
  settings: Settings,
  roots: Record<string, string> = {},
) {
  return [
    roots[asset.rootId] ?? asset.rootName,
    asset.relativeFolder,
    `${asset.stem}.${extension(asset, settings)}`,
  ]
    .filter(Boolean)
    .join("/");
}
export function validatePlan(
  assets: Asset[],
  settings: Settings,
  roots: Record<string, string>,
) {
  const errors: string[] = [];
  if (settings.resize)
    for (const value of [settings.maxWidth, settings.maxHeight]) {
      if (
        value !== "" &&
        (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 50000)
      )
        errors.push(
          "Dimension limits must be whole numbers between 1 and 50000 pixels.",
        );
    }
  const rootNames = new Map<string, string>();
  for (const a of assets) {
    const name = roots[a.rootId] ?? a.rootName;
    if (name) {
      const error = invalidStem(name);
      if (error) errors.push(`Root “${name}”: ${error}`);
      const prior = rootNames.get(name.toLocaleLowerCase());
      if (prior && prior !== a.rootId)
        errors.push(
          `Imported roots share the name “${name}”. Give each root a unique export name.`,
        );
      rootNames.set(name.toLocaleLowerCase(), a.rootId);
    }
    const error = invalidStem(a.stem);
    if (error) errors.push(`${a.originalName}: ${error}`);
  }
  return [...new Set(errors)];
}
export function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}
export function reduction(original: number, result: number) {
  const n = original ? ((original - result) / original) * 100 : 0;
  return n >= 0
    ? `${n.toFixed(1)}% smaller`
    : `Size increased by ${Math.abs(n).toFixed(1)}%`;
}
export function settingsKey(settings: Settings) {
  return JSON.stringify(settings);
}
// Prioritize the open comparison, then selected items and a small batch sample.
export function previewIds(
  assets: Pick<Asset, "id">[],
  selected: ReadonlySet<string>,
  compareId?: string,
  requested: ReadonlySet<string> = new Set(),
  includeSample = true,
) {
  const valid = new Set(assets.map((asset) => asset.id));
  const selection = [...selected].filter((id) => valid.has(id));
  return [
    ...new Set([
      ...(compareId ? [compareId] : []),
      ...selection,
      ...requested,
      ...(includeSample && selection.length < 3
        ? assets.slice(0, 3).map((asset) => asset.id)
        : []),
    ]),
  ].filter((id) => valid.has(id));
}

/** Hit-test the full layout, including rows that virtualization has unmounted. */
export function intersectingIndices(
  count: number,
  columns: number,
  rowHeight: number,
  width: number,
  rect: { left: number; right: number; top: number; bottom: number },
  rowGap = 16,
) {
  const gap = columns === 1 ? 0 : 15,
    cardWidth = (width - gap * (columns - 1)) / columns;
  const result: number[] = [];
  const first = Math.max(0, Math.floor(rect.top / rowHeight));
  const last = Math.min(
    Math.ceil(count / columns) - 1,
    Math.floor(rect.bottom / rowHeight),
  );
  for (let row = first; row <= last; row++)
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col,
        left = col * (cardWidth + gap),
        top = row * rowHeight;
      if (
        index < count &&
        rect.left < left + cardWidth &&
        rect.right > left &&
        rect.top < top + rowHeight - rowGap &&
        rect.bottom > top
      )
        result.push(index);
    }
  return result;
}
