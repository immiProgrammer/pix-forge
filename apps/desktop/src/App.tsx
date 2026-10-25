import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CaseLower,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Grid2X2,
  ImagePlus,
  Layers2,
  List,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Plus,
  Redo2,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  X,
  WandSparkles,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import Workspace from "./Workspace";
import Compare from "./Compare";
import AiRename from "./AiRename";
import Modal from "./Modal";
import Titlebar from "./Titlebar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from "./Popover";
import { Sheet, SheetTrigger, SheetClose, SheetContent } from "./Sheet";
import { useCompactLayout } from "./useCompactLayout";
import { AppSelect, AppCheckbox, AppSwitch } from "./Controls";
import ExportReport from "./ExportReport";
import {
  bytes,
  defaultSettings,
  extension,
  invalidStem,
  outputPath,
  previewIds,
  rename,
  restore,
  settingsKey,
  snapshot,
  validatePlan,
} from "./model";
import type {
  Asset,
  Format,
  History,
  NamingAction,
  NamingOptions,
  Processed,
  Settings,
} from "./model";
import {
  browserImport,
  cardImage,
  chooseDestination,
  chooseInput,
  desktop,
  dispose,
  droppedFiles,
  exportAssets,
  forgetAssets,
  processAsset,
  revealDestination,
  scan,
} from "./bridge";
import type { Collision, Progress } from "./bridge";
import type { CardSource } from "./bridge";
import PerformanceSettings from "./PerformanceSettings";
import { defaultPerformance, normalizePerformance } from "./performance";
import type { PerformanceOptions } from "./performance";
type Theme = "light" | "dark" | "system";
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const formats: { id: Format; label: string; description: string }[] = [
  {
    id: "webp",
    label: "WebP",
    description: "Lossy compression with transparency support.",
  },
  {
    id: "avif",
    label: "AVIF",
    description: "High compression. Slower encoding.",
  },
  {
    id: "jpg",
    label: "JPG",
    description: "Lossy compression. No transparency support.",
  },
  {
    id: "jpeg",
    label: "JPEG",
    description: "JPEG encoding, with the .jpeg extension.",
  },
  {
    id: "png",
    label: "PNG",
    description: "Lossless compression with transparency support.",
  },
  {
    id: "original",
    label: "Keep source format",
    description: "Keep each image in its original format.",
  },
];
export default function App() {
  const compact = useCompactLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    setSheetOpen(false);
  }, [compact]);
  const [assets, setAssets] = useState<Asset[]>([]),
    [selected, setSelected] = useState(new Set<string>()),
    [view, setView] = useState<"grid" | "list">(() =>
      stored("pixforge.view", "grid"),
    ),
    [imageFit, setImageFit] = useState<"fit" | "fill">(() =>
      stored<string>("pixforge.imageFit", "fit") === "fill" ? "fill" : "fit",
    ),
    [settings, setSettings] = useState<Settings>(() => ({
      ...defaultSettings,
      ...stored("pixforge.settings", {}),
    })),
    [theme, setTheme] = useState<Theme>(() =>
      stored("pixforge.theme", "system"),
    );
  const [performance, setPerformance] = useState<PerformanceOptions>(() =>
    normalizePerformance(stored("pixforge.performance", {})),
  );
  useEffect(() => {
    try {
      localStorage.setItem("pixforge.performance", JSON.stringify(performance));
    } catch {
      /* Preferences are optional when storage is unavailable. */
    }
  }, [performance]);
  const [history, setHistory] = useState<History>({ past: [], future: [] }),
    [previewSelection, setPreviewSelection] = useState<Set<string>>(new Set()),
    [requestedPreviews, setRequestedPreviews] = useState<Set<string>>(
      new Set(),
    ),
    [results, setResults] = useState<Record<string, Processed>>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [compareId, setCompareId] = useState<string>(),
    [scanning, setScanning] = useState(false),
    [pendingImports, setPendingImports] = useState<
      Record<string, number | null>
    >({}),
    [issues, setIssues] = useState<string[]>([]),
    [showIssues, setShowIssues] = useState(false),
    [notice, setNotice] = useState(""),
    [drop, setDrop] = useState(false),
    [panel, setPanel] = useState(true),
    [naming, setNaming] = useState(false),
    [scope, setScope] = useState<"all" | "selected">("all"),
    [namingOptions, setNamingOptions] = useState<NamingOptions>(() =>
      stored("pixforge.naming", {
        custom: "image",
        start: 1,
        padding: 3,
        separator: "-",
      }),
    ),
    [exportOpen, setExportOpen] = useState(false),
    [destination, setDestination] = useState(() =>
      desktop ? stored("pixforge.destination", "") : "",
    ),
    [subfolder, setSubfolder] = useState(""),
    [roots, setRoots] = useState<Record<string, string>>({}),
    [collision, setCollision] = useState<Collision>("suffix"),
    [progress, setProgress] = useState<Progress>(),
    [exportScope, setExportScope] = useState<"all" | "selected">("all"),
    [exportError, setExportError] = useState(""),
    [help, setHelp] = useState(false),
    [aiRenameOpen, setAiRenameOpen] = useState(false),
    [clearOpen, setClearOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    assetsRef = useRef(assets),
    cache = useRef(new Map<string, Processed>()),
    abortExport = useRef<AbortController | undefined>(undefined),
    importCount = useRef(0);
  const knownSources = useRef(new Set<string>());
  const importQueue = useRef<Asset[]>([]);
  const importFlushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const nativeBackgroundUpdate = useRef(Promise.resolve());
  const previousIds = useRef(new Set<string>());
  assetsRef.current = assets;
  useEffect(() => {
    if (compareId && !assets.some((asset) => asset.id === compareId))
      setCompareId(undefined);
  }, [assets, compareId]);
  useEffect(() => {
    const ids = new Set(assets.map((a) => a.id));
    const removed = [...previousIds.current].filter((id) => !ids.has(id));
    for (const id of removed) knownSources.current.delete(id);
    for (const id of ids) knownSources.current.add(id);
    previousIds.current = ids;
    if (removed.length) void forgetAssets(removed);
  }, [assets]);
  useEffect(() => {
    localStorage.setItem("pixforge.view", JSON.stringify(view));
    localStorage.setItem("pixforge.imageFit", JSON.stringify(imageFit));
    localStorage.setItem("pixforge.naming", JSON.stringify(namingOptions));
    if (desktop)
      localStorage.setItem("pixforge.destination", JSON.stringify(destination));
  }, [view, imageFit, namingOptions, destination]);
  const applySettings = (next: Settings) => {
    if (settingsKey(next) === settingsKey(settings)) return;
    setPreviewSelection(new Set(previewIds(assets, selected)));
    setRequestedPreviews(new Set());
    setSettings(next);
  };
  const changeSetting = <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => applySettings({ ...settings, [key]: value });
  useEffect(() => {
    localStorage.setItem("pixforge.settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("pixforge.theme", JSON.stringify(theme));
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      if (desktop) {
        const color = getComputedStyle(root)
          .getPropertyValue("--subtle")
          .trim();
        // Serialize updates so rapid theme switches leave both native layers
        // on the most recently requested color.
        nativeBackgroundUpdate.current = nativeBackgroundUpdate.current
          .then(() => getCurrentWebviewWindow().setBackgroundColor(color))
          .catch((error) =>
            setNotice(`Could not update window background: ${error}`),
          );
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const reportIssue = useCallback((message: string) => {
    setIssues((v) => [...v, message]);
    setNotice(message);
  }, []);
  const flushImports = useCallback(() => {
    clearTimeout(importFlushTimer.current);
    importFlushTimer.current = undefined;
    const incoming = importQueue.current;
    importQueue.current = [];
    if (incoming.length) setAssets((current) => [...current, ...incoming]);
  }, []);
  useEffect(() => () => clearTimeout(importFlushTimer.current), []);
  const updateSource = useCallback((id: string, source: CardSource) => {
    const previous = assetsRef.current.find((asset) => asset.id === id);
    if (
      !previous ||
      (previous.sourceVersion === source.sourceVersion &&
        previous.width === source.width &&
        previous.height === source.height &&
        previous.bytes === source.bytes &&
        previous.format === source.format)
    )
      return;
    if (previous.sourceVersion !== source.sourceVersion) {
      for (const [cacheKey, result] of cache.current) {
        if (cacheKey.startsWith(`${id}:`)) {
          dispose(result);
          cache.current.delete(cacheKey);
        }
      }
      setResults((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setErrors((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    setAssets((current) =>
      current.map((asset) =>
        asset.id === id
          ? {
              ...asset,
              width: source.width,
              height: source.height,
              bytes: source.bytes,
              format: source.format,
              sourceVersion: source.sourceVersion,
              thumbnail: source.url,
            }
          : asset,
      ),
    );
  }, []);
  const addAsset = useCallback(
    (asset: Asset) => {
      if (knownSources.current.has(asset.id)) {
        setNotice(`${asset.originalName} is already in the workspace.`);
        setIssues((v) => [
          ...v,
          `${asset.originalName}: Already imported; duplicate skipped`,
        ]);
        return;
      }
      knownSources.current.add(asset.id);
      importQueue.current.push(asset);
      importFlushTimer.current ??= setTimeout(flushImports, 16);
    },
    [flushImports],
  );
  const startImport = useCallback((count: number | null) => {
    const id = crypto.randomUUID();
    importCount.current++;
    setScanning(true);
    setPendingImports((current) => ({ ...current, [id]: count }));
    return id;
  }, []);
  const settleImportItem = useCallback((id: string) => {
    setPendingImports((current) => {
      const remaining = current[id];
      return remaining == null
        ? current
        : { ...current, [id]: Math.max(0, remaining - 1) };
    });
  }, []);
  const finishImport = useCallback(
    (id: string) => {
      flushImports();
      importCount.current--;
      setScanning(importCount.current > 0);
      setPendingImports((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    [flushImports],
  );
  const importPaths = useCallback(
    async (paths: string[], folders = true) => {
      if (!paths.length) return;
      const job = startImport(folders ? null : paths.length);
      try {
        await scan(paths, addAsset, reportIssue, () => settleImportItem(job));
      } catch (e) {
        reportIssue(String(e));
      } finally {
        finishImport(job);
      }
    },
    [addAsset, reportIssue, startImport, settleImportItem, finishImport],
  );
  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") setDrop(true);
        if (event.payload.type === "leave") setDrop(false);
        if (event.payload.type === "drop") {
          setDrop(false);
          void importPaths(event.payload.paths);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [importPaths]);
  async function importFiles(files: File[]) {
    if (!files.length) return;
    const job = startImport(files.length);
    try {
      await browserImport(files, addAsset, reportIssue, () =>
        settleImportItem(job),
      );
    } finally {
      finishImport(job);
    }
  }
  async function importImages(folder: boolean) {
    if (desktop) {
      try {
        const paths = await chooseInput(folder);
        if (paths.length) await importPaths(paths, folder);
      } catch (e) {
        setNotice(String(e));
      }
    } else (folder ? folderInput : fileInput).current?.click();
  }
  function commit(next: Asset[]) {
    if (JSON.stringify(snapshot(next)) === JSON.stringify(snapshot(assets)))
      return;
    setHistory((h) => ({
      past: [...h.past.slice(-99), snapshot(assets)],
      future: [],
    }));
    setAssets(next);
  }
  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.past.length) return h;
      setAssets((current) => restore(current, h.past.at(-1)!));
      return {
        past: h.past.slice(0, -1),
        future: [snapshot(assetsRef.current), ...h.future],
      };
    });
  }, []);
  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h.future.length) return h;
      setAssets((current) => restore(current, h.future[0]));
      return {
        past: [...h.past, snapshot(assetsRef.current)],
        future: h.future.slice(1),
      };
    });
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,.ui-select-positioner,.ui-select-trigger,.ui-checkbox,.ui-switch,.ui-popover-positioner",
        ) ||
        exportOpen ||
        sheetOpen ||
        compareId ||
        showIssues ||
        clearOpen ||
        help ||
        aiRenameOpen
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(assetsRef.current.map((a) => a.id)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.size) {
          setAssets((a) => a.filter((x) => !selected.has(x.id)));
          setSelected(new Set());
        }
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    selected,
    undo,
    redo,
    exportOpen,
    sheetOpen,
    compareId,
    showIssues,
    clearOpen,
    help,
    aiRenameOpen,
  ]);
  const key = settingsKey(settings);
  const previousCompareId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    const openingComparison =
      !!compareId && compareId !== previousCompareId.current;
    previousCompareId.current = compareId;
    const timer = setTimeout(
      async () => {
        const ids = previewIds(
          assets,
          previewSelection,
          compareId,
          requestedPreviews,
          false,
        );
        const valid = new Set(assets.map((a) => a.id));
        const currentResults: Record<string, Processed> = {};
        for (const [cacheKey, result] of cache.current) {
          const id = cacheKey.slice(0, cacheKey.lastIndexOf(":{"));
          if (!valid.has(id) || !cacheKey.endsWith(key)) {
            dispose(result);
            cache.current.delete(cacheKey);
          }
        }
        for (const id of ids) {
          if (controller.signal.aborted) break;
          const asset = assets.find((a) => a.id === id);
          if (!asset) continue;
          const cacheKey = `${id}:${key}`;
          const cached = cache.current.get(cacheKey);
          // Native cache paths may have been evicted; let Rust revalidate them.
          if (cached && !desktop) {
            currentResults[id] = cached;
            setResults((r) => ({ ...r, [id]: cached }));
            continue;
          }
          try {
            const result = await processAsset(
              asset,
              settings,
              controller.signal,
            );
            if (controller.signal.aborted) {
              dispose(result);
              break;
            }
            if (
              desktop &&
              result.sourceVersion &&
              result.sourceVersion !== asset.sourceVersion
            ) {
              const source = await cardImage(asset, false, controller.signal);
              if (controller.signal.aborted) {
                dispose(result);
                break;
              }
              updateSource(id, source);
              dispose(result);
              continue;
            }
            cache.current.set(cacheKey, result);
            currentResults[id] = result;
            setResults((r) => ({ ...r, [id]: result }));
            if (cache.current.size > 60) {
              const oldest = [...cache.current.keys()].find(
                (k) => !ids.some((id) => k === `${id}:${key}`),
              );
              if (oldest) {
                dispose(cache.current.get(oldest)!);
                cache.current.delete(oldest);
                const evictedId = oldest.slice(0, oldest.lastIndexOf(":{"));
                setResults((r) => {
                  const next = { ...r };
                  delete next[evictedId];
                  return next;
                });
              }
            }
          } catch (e) {
            if (!controller.signal.aborted)
              setErrors((err) => ({ ...err, [id]: String(e) }));
          }
        }
      },
      openingComparison ? 0 : 280,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    previewSelection,
    requestedPreviews,
    key,
    compareId,
    assets,
    updateSource,
  ]);
  useEffect(() => {
    setResults({});
    setErrors({});
  }, [key]);
  function runNaming(action: NamingAction) {
    const target =
      scope === "selected" ? selected : new Set(assets.map((a) => a.id));
    if (!target.size) {
      setNotice("Select images first.");
      return;
    }
    const next = rename(assets, target, action, namingOptions);
    const invalid = next.find((a) => invalidStem(a.stem));
    if (invalid) {
      setNotice(`${invalid.originalName}: ${invalidStem(invalid.stem)}`);
      return;
    }
    const paths = next.map((a) =>
      outputPath(a, settings, roots).toLocaleLowerCase(),
    );
    if (new Set(paths).size !== paths.length) {
      setNotice(
        "Naming would create conflicting output paths. Adjust the names or sequence.",
      );
      return;
    }
    commit(next);
    setNotice(
      `${action === "slug" ? "Names slugified" : "Images renamed"} · Undo is available`,
    );
  }
  const exportTargets =
    exportScope === "selected"
      ? assets.filter((a) => selected.has(a.id))
      : assets;
  const rootList = [
    ...new Map(
      assets.filter((a) => a.rootName).map((a) => [a.rootId, a.rootName]),
    ).entries(),
  ];
  const planErrors = validatePlan(exportTargets, settings, roots);
  if (subfolder && invalidStem(subfolder))
    planErrors.push(`Output folder: ${invalidStem(subfolder)}`);
  const paths = exportTargets.map((a) => outputPath(a, settings, roots));
  const duplicatePaths =
    paths.length - new Set(paths.map((p) => p.toLocaleLowerCase())).size;
  async function pickDestination() {
    try {
      const path = await chooseDestination();
      if (path) setDestination(path);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setExportError(String(e));
    }
  }
  async function startExport(retry = false) {
    setExportError("");
    const targets = retry
      ? assets.filter((a) => progress?.failedIds?.includes(a.id))
      : exportTargets;
    if (!destination || !targets.length || planErrors.length) return;
    const controller = new AbortController();
    abortExport.current = controller;
    setProgress({
      completed: 0,
      failed: 0,
      total: targets.length,
      current: "Preparing export…",
    });
    try {
      const result = await exportAssets(
        targets,
        settings,
        destination,
        subfolder,
        roots,
        collision,
        setProgress,
        controller.signal,
        assets,
        performance,
      );
      setProgress({ ...result, done: true });
    } catch (e) {
      setExportError(String(e));
      setProgress((p) => (p ? { ...p, done: true } : undefined));
    } finally {
      abortExport.current = undefined;
    }
  }
  const actualResults = Object.fromEntries(
    Object.entries(results).filter(([id, r]) => r.key === `${id}:${key}`),
  );
  const totalBytes = assets.reduce((n, a) => n + a.bytes, 0);
  const processedBytes = Object.values(actualResults).reduce(
    (n, r) => n + r.bytes,
    0,
  );
  const compareAsset = assets.find((a) => a.id === compareId);
  const busy = !!progress && !progress.done;
  const settingsToggle = compact ? (
    <SheetTrigger
      className={`icon-button panel-toggle ${sheetOpen ? "pressed" : ""}`}
      aria-label="Open output settings"
      title="Output settings"
    >
      <SlidersHorizontal size={16} />
    </SheetTrigger>
  ) : (
    <button
      className={`icon-button panel-toggle ${panel ? "pressed" : ""}`}
      title="Toggle output settings"
      aria-label="Toggle output settings"
      onClick={() => setPanel(!panel)}
    >
      <SlidersHorizontal size={16} />
    </button>
  );
  const settingsPanel = (
    <aside className="settings-panel">
      <div className="panel-header">
        <div>
          <Settings2 size={16} />
          <h2>Output settings</h2>
        </div>
        <div className="panel-header-actions">
          {" "}
          <button
            className="icon-button"
            aria-label="Reset output settings"
            title="Reset output settings"
            onClick={() => {
              applySettings(defaultSettings);
              setPerformance(defaultPerformance);
            }}
          >
            <RotateCcw size={14} />
          </button>
          {compact && (
            <SheetClose
              className="icon-button"
              aria-label="Close settings"
              title="Close settings"
            >
              <X size={17} />
            </SheetClose>
          )}
        </div>
      </div>
      <div className="settings-scroll">
        <section className="setting-section">
          <div className="section-label">
            <span className="step-number">1</span>
            <h3>Format & quality</h3>
          </div>
          <div className="field-label">Output format</div>
          <div className="format-options">
            {formats.slice(0, 5).map((f) => (
              <button
                className={settings.format === f.id ? "active" : ""}
                key={f.id}
                onClick={() => changeSetting("format", f.id)}
              >
                {f.label}
                {f.id === "webp" && <span className="recommended-dot" />}
              </button>
            ))}
          </div>
          <button
            id="output-format"
            className={`original-format ${settings.format === "original" ? "active" : ""}`}
            onClick={() => changeSetting("format", "original")}
          >
            <span className="radio-dot" /> Keep source format
          </button>
          <p className="setting-help format-description">
            {formats.find((f) => f.id === settings.format)?.description}
          </p>
          {settings.format === "original" && (
            <label className="check-label">
              <AppCheckbox
                label="Recompress source images"
                checked={settings.compressOriginal}
                onCheckedChange={(value) =>
                  changeSetting("compressOriginal", value)
                }
              />{" "}
              Recompress source images
            </label>
          )}
          {settings.format === "png" ? (
            <>
              <label className="field-label">
                Lossless compression
                <AppSelect<Settings["pngCompression"]>
                  label="Lossless compression"
                  value={settings.pngCompression}
                  onValueChange={(value) =>
                    changeSetting("pngCompression", value)
                  }
                  options={[
                    { value: "fast", label: "Fast" },
                    { value: "balanced", label: "Balanced" },
                    { value: "best", label: "Maximum compression" },
                  ]}
                />
              </label>
              <p className="setting-help">
                All pixels preserved. Compression affects processing time.
              </p>
            </>
          ) : (
            <>
              <div className="range-label">
                <label htmlFor="quality">Quality</label>
                <output>
                  {settings.quality}
                  <span>%</span>
                </output>
              </div>
              <input
                id="quality"
                className="quality-slider"
                type="range"
                min={0}
                max={100}
                value={settings.quality}
                style={
                  {
                    "--range": `${settings.quality}%`,
                  } as React.CSSProperties
                }
                onChange={(e) => changeSetting("quality", +e.target.value)}
                disabled={
                  settings.format === "original" && !settings.compressOriginal
                }
              />
              <div className="range-captions">
                <span>Smaller file</span>
                <span>Higher quality</span>
              </div>
            </>
          )}
          {["jpg", "jpeg"].includes(settings.format) && (
            <label className="color-label">
              Transparency background
              <input
                type="color"
                value={settings.background}
                onChange={(e) => changeSetting("background", e.target.value)}
              />
            </label>
          )}
          {settings.format === "original" && (
            <p className="setting-help">
              PNG uses lossless compression. JPEG transparency is flattened to
              white.
            </p>
          )}
        </section>
        <section className="setting-section">
          <div className="section-label">
            <span className="step-number">2</span>
            <h3>Image dimensions</h3>
            <AppSwitch
              label="Enable dimension limits"
              checked={settings.resize}
              onCheckedChange={(value) => changeSetting("resize", value)}
            />
          </div>
          <div
            className={`dimension-fields ${!settings.resize ? "disabled-fields" : ""}`}
          >
            <label>
              Max. width
              <div>
                <input
                  type="number"
                  min={1}
                  max={50000}
                  placeholder="No limit"
                  aria-label="Maximum width"
                  disabled={!settings.resize}
                  value={settings.maxWidth}
                  onChange={(e) => changeSetting("maxWidth", e.target.value)}
                />
                <span>px</span>
              </div>
            </label>
            <span className="dimension-cross">×</span>
            <label>
              Max. height
              <div>
                <input
                  type="number"
                  min={1}
                  max={50000}
                  placeholder="No limit"
                  aria-label="Maximum height"
                  disabled={!settings.resize}
                  value={settings.maxHeight}
                  onChange={(e) => changeSetting("maxHeight", e.target.value)}
                />
                <span>px</span>
              </div>
            </label>
          </div>
          <label className="check-label">
            <AppCheckbox
              label="Allow upscaling"
              checked={settings.upscale}
              disabled={!settings.resize}
              onCheckedChange={(value) => changeSetting("upscale", value)}
            />{" "}
            Allow upscaling
          </label>
          <p className="setting-help">Preserve aspect ratio.</p>
        </section>
        <PerformanceSettings
          value={performance}
          onChange={setPerformance}
          native={desktop}
          disabled={!desktop || !!(progress && !progress.done)}
        />
        <section className="setting-section destination-section">
          <div className="section-label">
            <span className="step-number">3</span>
            <h3>Save destination</h3>
          </div>
          <button
            className="destination-picker"
            onClick={() => void pickDestination()}
          >
            <span className="folder-icon">
              <Folder size={19} />
            </span>
            <span>
              {destination ? (
                <>
                  <strong>{destination.split(/[\\/]/).at(-1)}</strong>
                  <small>{destination}</small>
                </>
              ) : (
                <>
                  <strong>Choose a folder</strong>
                  <small>Output directory</small>
                </>
              )}
            </span>
            <ChevronRight size={15} />
          </button>
          <div className="structure-note">
            <Layers2 size={14} />
            <span>Preserve folder structure</span>
            <Check size={13} />
          </div>
        </section>
      </div>
      <div className="export-section">
        <div className="export-summary">
          <span>
            {assets.length ? `${assets.length} images` : "No images imported"}
          </span>
          <span>{assets.length ? bytes(totalBytes) : "✦"}</span>
        </div>
        <button
          className="primary export-button"
          disabled={!assets.length || scanning}
          onClick={() => {
            setExportScope(selected.size ? "selected" : "all");
            setProgress(undefined);
            setExportError("");
            setSheetOpen(false);
            setExportOpen(true);
          }}
        >
          <ArrowDownToLine size={17} />
          {selected.size ? `Export ${selected.size} selected` : "Export images"}
          <ArrowRight size={16} />
        </button>
      </div>
    </aside>
  );
  return (
    <Sheet open={compact && sheetOpen} onOpenChange={setSheetOpen}>
      <div
        className="app"
        onDragOver={(e) => {
          if (!desktop) {
            e.preventDefault();
            setDrop(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDrop(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setDrop(false);
          if (!desktop) {
            const discovery = startImport(null);
            let files: File[] | undefined;
            try {
              files = await droppedFiles(e.dataTransfer);
            } catch (err) {
              reportIssue(String(err));
            } finally {
              finishImport(discovery);
            }
            if (files) await importFiles(files);
          }
        }}
      >
        <input
          ref={fileInput}
          className="hidden"
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => {
            void importFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          className="hidden"
          type="file"
          multiple
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(e) => {
            void importFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <Titlebar onError={setNotice} onHelp={() => setHelp(true)} />

        <div className="workbench">
          <div className="workbench-body">
            <main className="workspace-shell">
              {!compareAsset && (
                <div className="toolbar">
                  <div className="toolbar-group">
                    <div className="split-button">
                      <button
                        className="primary"
                        onClick={() => void importImages(false)}
                      >
                        <Plus size={16} /> Add images
                      </button>
                      <button
                        className="primary split-end"
                        aria-label="Add folder"
                        title="Add folder"
                        onClick={() => void importImages(true)}
                      >
                        <FolderPlus size={15} />
                      </button>
                    </div>
                    <div className="toolbar-divider" />
                    <button
                      className="text-button select-all"
                      disabled={!assets.length}
                      onClick={() =>
                        setSelected(
                          selected.size === assets.length
                            ? new Set()
                            : new Set(assets.map((a) => a.id)),
                        )
                      }
                    >
                      {selected.size === assets.length && assets.length
                        ? "Deselect all"
                        : "Select all"}
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <div className="toolbar-group toolbar-right">
                    <div className="naming-anchor">
                      <Popover open={naming} onOpenChange={setNaming}>
                        <PopoverTrigger
                          className={`text-button ${naming ? "pressed" : ""}`}
                          disabled={!assets.length}
                        >
                          <CaseLower size={18} /> Rename{" "}
                          <ChevronDown size={12} />
                        </PopoverTrigger>
                        <PopoverContent
                          className="naming-popover"
                          align="center"
                        >
                          <div className="popover-title">
                            <PopoverTitle className="rename-title">
                              Batch rename
                            </PopoverTitle>
                          </div>
                          <label className="field-label">
                            Apply to
                            <AppSelect<"all" | "selected">
                              label="Naming scope"
                              value={scope}
                              onValueChange={setScope}
                              options={[
                                {
                                  value: "all",
                                  label: `All images (${assets.length})`,
                                },
                                {
                                  value: "selected",
                                  label: `Selected images (${selected.size})`,
                                },
                              ]}
                            />
                          </label>
                          <div className="naming-numbers">
                            <label>
                              Start at
                              <input
                                type="number"
                                min={0}
                                value={namingOptions.start}
                                onChange={(e) =>
                                  setNamingOptions((v) => ({
                                    ...v,
                                    start: Math.max(0, +e.target.value),
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Padding
                              <input
                                type="number"
                                min={1}
                                max={8}
                                value={namingOptions.padding}
                                onChange={(e) =>
                                  setNamingOptions((v) => ({
                                    ...v,
                                    padding: Math.max(
                                      1,
                                      Math.min(8, +e.target.value),
                                    ),
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Separator
                              <AppSelect
                                label="Filename separator"
                                value={namingOptions.separator}
                                onValueChange={(separator) =>
                                  setNamingOptions((v) => ({ ...v, separator }))
                                }
                                options={[
                                  { value: "-", label: "Dash ( - )" },
                                  { value: "_", label: "Underscore" },
                                  { value: " ", label: "Space" },
                                  { value: "", label: "None" },
                                ]}
                              />
                            </label>
                          </div>
                          <button
                            className="naming-action"
                            onClick={() => runNaming("folder")}
                          >
                            <Folder size={16} />
                            <span>
                              Folder name + index
                              <small>shoes-001, shoes-002</small>
                            </span>
                            <ArrowRight size={15} />
                          </button>
                          <label className="field-label">
                            Custom name
                            <input
                              value={namingOptions.custom}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  !e.nativeEvent.isComposing
                                ) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!e.repeat) runNaming("custom");
                                }
                              }}
                              onChange={(e) =>
                                setNamingOptions((v) => ({
                                  ...v,
                                  custom: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <button
                            className="naming-action"
                            onClick={() => runNaming("custom")}
                          >
                            <CaseLower size={17} />
                            <span>
                              Custom name + index
                              <small>
                                {namingOptions.custom}
                                {namingOptions.separator}
                                {String(namingOptions.start).padStart(
                                  namingOptions.padding,
                                  "0",
                                )}
                              </small>
                            </span>
                            <ArrowRight size={15} />
                          </button>
                          <button
                            className="naming-action"
                            onClick={() => runNaming("slug")}
                          >
                            <Sparkles size={16} />
                            <span>
                              Slugify current names
                              <small>Summer Photo → summer-photo</small>
                            </span>
                            <ArrowRight size={15} />
                          </button>
                          <p className="popover-hint">
                            <LockKeyhole size={12} /> Excluded images keep their
                            names.
                          </p>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <button
                      className="text-button"
                      disabled={!assets.length}
                      onClick={() => setAiRenameOpen(true)}
                      title="Generate an AI renaming prompt and import a filename mapping"
                    >
                      <WandSparkles size={16} /> AI rename
                    </button>
                    <div className="toolbar-divider" />
                    <button
                      className="icon-button"
                      disabled={!history.past.length}
                      title="Undo (Ctrl/Cmd+Z)"
                      aria-label="Undo naming"
                      onClick={undo}
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={!history.future.length}
                      title="Redo (Ctrl/Cmd+Shift+Z)"
                      aria-label="Redo naming"
                      onClick={redo}
                    >
                      <Redo2 size={16} />
                    </button>
                    <div className="toolbar-divider" />
                    <button
                      className="icon-button"
                      title={
                        selected.size
                          ? "Remove selected images"
                          : "Clear workspace"
                      }
                      aria-label={
                        selected.size
                          ? "Remove selected images"
                          : "Clear workspace"
                      }
                      disabled={!assets.length}
                      onClick={() => {
                        if (selected.size) {
                          setAssets((a) =>
                            a.filter((x) => !selected.has(x.id)),
                          );
                          setSelected(new Set());
                        } else setClearOpen(true);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                    <div className="toolbar-preferences">
                      <div className="segmented view-switch">
                        <button
                          className={view === "grid" ? "active" : ""}
                          aria-label="Grid view"
                          title="Grid view"
                          onClick={() => setView("grid")}
                        >
                          <Grid2X2 size={16} />
                        </button>
                        <button
                          className={view === "list" ? "active" : ""}
                          aria-label="List view"
                          title="List view"
                          onClick={() => setView("list")}
                        >
                          <List size={17} />
                        </button>
                      </div>
                      <div
                        className="segmented view-switch image-fit-switch"
                        role="group"
                        aria-label="Card image display"
                      >
                        <button
                          className={imageFit === "fit" ? "active" : ""}
                          aria-pressed={imageFit === "fit"}
                          title="Fit the whole image inside its card"
                          onClick={() => setImageFit("fit")}
                        >
                          Fit
                        </button>
                        <button
                          className={imageFit === "fill" ? "active" : ""}
                          aria-pressed={imageFit === "fill"}
                          title="Fill the card, cropping image edges if needed"
                          onClick={() => setImageFit("fill")}
                        >
                          Fill
                        </button>
                      </div>
                      <AppSelect<Theme>
                        label="Theme"
                        className="theme-control"
                        align="end"
                        icon={<Monitor size={15} aria-hidden="true" />}
                        value={theme}
                        onValueChange={setTheme}
                        options={[
                          { value: "system", label: "System" },
                          { value: "light", label: "Light" },
                          { value: "dark", label: "Dark" },
                        ]}
                      />
                    </div>
                    {settingsToggle}
                  </div>
                </div>
              )}
              <div className="file-workspace" hidden={!!compareAsset}>
                <Workspace
                  imageFit={imageFit}
                  onSourceChange={updateSource}
                  assets={assets}
                  selected={selected}
                  setSelected={setSelected}
                  view={view}
                  settings={settings}
                  results={actualResults}
                  errors={errors}
                  previewing={
                    new Set(
                      previewIds(
                        assets,
                        previewSelection,
                        compareId,
                        requestedPreviews,
                        false,
                      ),
                    )
                  }
                  onProcess={(id) => {
                    setErrors((current) => {
                      const next = { ...current };
                      delete next[id];
                      return next;
                    });
                    setRequestedPreviews(
                      (current) => new Set([...current, id]),
                    );
                  }}
                  onRename={(id, name) =>
                    commit(
                      assets.map((a) =>
                        a.id === id ? { ...a, stem: name } : a,
                      ),
                    )
                  }
                  onCompare={(id) => {
                    setPanel(true);
                    setCompareId(id);
                  }}
                  onExclude={(id) =>
                    commit(
                      assets.map((a) =>
                        a.id === id ? { ...a, excluded: !a.excluded } : a,
                      ),
                    )
                  }
                  onImport={(folder) => void importImages(folder)}
                  scanning={scanning}
                  loadingCount={Math.min(
                    3,
                    Object.values(pendingImports).reduce<number>(
                      (sum, remaining) => sum + (remaining ?? 3),
                      0,
                    ),
                  )}
                />
              </div>
              {compareAsset && (
                <Compare
                  settingsControl={settingsToggle}
                  asset={compareAsset}
                  format={extension(compareAsset, settings)}
                  result={actualResults[compareAsset.id]}
                  error={errors[compareAsset.id]}
                  onClose={() => {
                    setCompareId(undefined);
                    requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(".workspace")
                        ?.focus({ preventScroll: true }),
                    );
                  }}
                  onNavigate={(direction) => {
                    const index = assets.findIndex((a) => a.id === compareId);
                    if (assets[index + direction])
                      setCompareId(assets[index + direction].id);
                  }}
                  index={assets.findIndex((a) => a.id === compareId)}
                  total={assets.length}
                />
              )}
            </main>
            {compact ? (
              <SheetContent suppressReturnFocus={exportOpen}>
                {settingsPanel}
              </SheetContent>
            ) : (
              panel && settingsPanel
            )}
          </div>
          <footer className="status-bar">
            <div>
              <span className={`status-dot ${scanning ? "scanning" : ""}`} />
              <span>
                {scanning
                  ? "Scanning images…"
                  : assets.length
                    ? "Workspace ready"
                    : "Ready"}
              </span>
              <i />
              <span>{assets.length} images</span>
              {selected.size > 0 && (
                <>
                  <i />
                  <span>{selected.size} selected</span>
                </>
              )}
              {issues.length > 0 && (
                <button
                  className="issue-link"
                  onClick={() => setShowIssues(true)}
                >
                  {issues.length} import notices
                </button>
              )}
            </div>
            <div>
              {assets.length > 0 && (
                <span>
                  {bytes(totalBytes)} original
                  {processedBytes > 0
                    ? ` · ${bytes(processedBytes)} previewed (${Object.keys(actualResults).length}/${assets.length})`
                    : ""}
                </span>
              )}
            </div>
          </footer>
        </div>
        {drop && (
          <div className="drop-overlay">
            <div>
              <ImagePlus size={44} />
              <h2>Import images</h2>
              <p>Drop files or folders to add them.</p>
            </div>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Check size={16} />
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {exportOpen && (
          <Modal
            className={`dialog export-dialog ${progress?.done ? "export-finished" : ""}`}
            label="Review export"
            onClose={() => setExportOpen(false)}
            locked={busy}
          >
            <header>
              <div>
                <span className="eyebrow">EXPORT</span>
                <h2>{progress?.done ? "Export results" : "Review export"}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close export"
                disabled={busy}
                onClick={() => setExportOpen(false)}
                autoFocus
              >
                <X size={20} />
              </button>
            </header>
            {!progress?.done && (
              <>
                <p className="dialog-intro">
                  Your originals stay right where they are. We’ll save the new
                  files below.
                </p>
                <label className="field-label">
                  Images to export
                  <AppSelect<"all" | "selected">
                    label="Images to export"
                    value={exportScope}
                    disabled={busy}
                    onValueChange={setExportScope}
                    options={[
                      { value: "all", label: `All images (${assets.length})` },
                      {
                        value: "selected",
                        label: `Selected images (${selected.size})`,
                        disabled: !selected.size,
                      },
                    ]}
                  />
                </label>
                <label className="field-label">
                  Destination
                  <button
                    className="destination-picker"
                    disabled={busy}
                    onClick={() => void pickDestination()}
                  >
                    <Folder size={18} />
                    <span>{destination || "Choose an output folder"}</span>
                    <ChevronRight size={15} />
                  </button>
                </label>
                <label className="field-label">
                  Create a folder inside destination{" "}
                  <span className="muted">(optional)</span>
                  <input
                    value={subfolder}
                    disabled={busy}
                    placeholder="e.g. website-ready"
                    onChange={(e) => setSubfolder(e.target.value)}
                  />
                </label>
                {rootList.length > 0 && (
                  <details>
                    <summary>
                      Imported root folders <span>{rootList.length}</span>
                    </summary>
                    <p className="setting-help">
                      These names appear in your output structure. Give
                      duplicate roots unique names.
                    </p>
                    {rootList.map(([id, name]) => (
                      <label key={id} className="root-rename">
                        {name}
                        <input
                          aria-label={`Export root ${name} ${id}`}
                          disabled={busy}
                          value={roots[id] ?? name}
                          onChange={(e) =>
                            setRoots((r) => ({ ...r, [id]: e.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </details>
                )}
                <label className="field-label">
                  If an output file already exists
                  <AppSelect<Collision>
                    label="Existing file handling"
                    value={collision}
                    disabled={busy}
                    onValueChange={setCollision}
                    options={[
                      {
                        value: "suffix",
                        label: "Add suffix — keep both files (recommended)",
                      },
                      { value: "skip", label: "Skip — keep the existing file" },
                      {
                        value: "replace",
                        label: "Replace — overwrite the existing file",
                      },
                    ]}
                  />
                </label>
                {duplicatePaths > 0 && (
                  <div className="warning-note">
                    {duplicatePaths} duplicate output paths.{" "}
                    {collision === "replace"
                      ? "Use Add suffix or rename conflicting images."
                      : "Your collision choice will be applied."}
                  </div>
                )}
                <div className="path-preview">
                  <span>OUTPUT PREVIEW</span>
                  {paths.slice(0, 3).map((path, i) => (
                    <code key={`${path}${i}`}>
                      <Folder size={12} />
                      {subfolder ? `${subfolder}/` : ""}
                      {path}
                    </code>
                  ))}
                  {paths.length > 3 && (
                    <small>+ {paths.length - 3} more images</small>
                  )}
                </div>
                {planErrors.length > 0 && (
                  <div className="error-note">
                    {planErrors.slice(0, 4).map((e) => (
                      <p key={e}>{e}</p>
                    ))}
                  </div>
                )}
              </>
            )}
            {progress && (
              <div className="export-progress" aria-live="polite">
                <div>
                  {busy && <LoaderCircle className="spin" size={17} />}
                  <strong>
                    {progress.done
                      ? progress.cancelled
                        ? "Export cancelled"
                        : progress.failed
                          ? "Export finished with errors"
                          : "Export complete"
                      : "Preparing your images…"}
                  </strong>
                  <span>
                    {progress.completed +
                      progress.failed +
                      (progress.skipped || 0)}{" "}
                    / {progress.total}
                  </span>
                </div>
                <progress
                  value={
                    progress.completed +
                    progress.failed +
                    (progress.skipped || 0)
                  }
                  max={progress.total}
                />
                <p>
                  {progress.completed} saved · {progress.failed} failed
                  {progress.skipped ? ` · ${progress.skipped} skipped` : ""}
                  {progress.cancelled ? " · Completed files were kept." : ""}
                </p>
                {busy && <small>{progress.current}</small>}
                {progress.failures &&
                  Object.keys(progress.failures).length > 0 && (
                    <ul className="issue-list">
                      {Object.entries(progress.failures).map(([id, error]) => (
                        <li key={id}>
                          {assets.find((a) => a.id === id)?.originalName}:{" "}
                          {error}
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}
            {progress?.done &&
              progress.outputs &&
              progress.outputs.length > 0 && (
                <ExportReport outputs={progress.outputs} />
              )}
            {exportError && <div className="error-note">{exportError}</div>}
            <footer>
              {progress?.done ? (
                <>
                  <button onClick={() => setExportOpen(false)}>
                    Back to workspace
                  </button>
                  {progress.failed > 0 && (
                    <button onClick={() => void startExport(true)}>
                      Retry failed images
                    </button>
                  )}
                  {desktop && progress.completed > 0 && (
                    <button
                      className="primary"
                      onClick={() => void revealDestination(destination)}
                    >
                      <Folder size={16} /> Open output folder
                    </button>
                  )}
                </>
              ) : busy ? (
                <button onClick={() => abortExport.current?.abort()}>
                  Cancel export
                </button>
              ) : (
                <>
                  <span className="safe-note">
                    <ShieldCheck size={14} /> Originals protected
                  </span>
                  <button
                    className="primary"
                    disabled={
                      !destination ||
                      !exportTargets.length ||
                      !!planErrors.length ||
                      (duplicatePaths > 0 && collision === "replace")
                    }
                    onClick={() => void startExport()}
                  >
                    <ArrowDownToLine size={16} /> Export {exportTargets.length}{" "}
                    images
                  </button>
                </>
              )}
            </footer>
          </Modal>
        )}
        {aiRenameOpen && (
          <AiRename
            assets={assets}
            selected={selected}
            settings={settings}
            roots={roots}
            onClose={() => setAiRenameOpen(false)}
            onApply={(next, count) => {
              commit(next);
              setAiRenameOpen(false);
              setNotice(`${count} image names updated. Undo is available.`);
            }}
          />
        )}
        {showIssues && (
          <SimpleDialog
            title="Import notices"
            onClose={() => setShowIssues(false)}
          >
            <p>Valid images were imported. Review the skipped files below.</p>
            <ul className="issue-list">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
            <button
              onClick={() => {
                setIssues([]);
                setShowIssues(false);
              }}
            >
              Dismiss notices
            </button>
          </SimpleDialog>
        )}
        {clearOpen && (
          <SimpleDialog
            title="Clear your workspace?"
            onClose={() => setClearOpen(false)}
          >
            <p>
              This removes images from this session. Your original files stay
              untouched.
            </p>
            <button
              className="primary"
              onClick={() => {
                setAssets([]);
                setSelected(new Set());
                setHistory({ past: [], future: [] });
                setClearOpen(false);
              }}
            >
              Clear workspace
            </button>
          </SimpleDialog>
        )}
        {help && (
          <SimpleDialog
            title="A few handy shortcuts"
            onClose={() => setHelp(false)}
          >
            <div className="shortcuts">
              {[
                ["Select all", "Ctrl / ⌘ + A"],
                ["Toggle selection", "Ctrl / ⌘ + click"],
                ["Select a range", "Shift + click"],
                ["Move selection", "Arrow keys"],
                ["Open comparison", "Double-click / Enter"],
                ["Undo naming", "Ctrl / ⌘ + Z"],
                ["Redo naming", "Ctrl / ⌘ + Shift + Z"],
                ["Remove selected", "Delete"],
                ["Close comparison", "Esc"],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <p className="setting-help">
              Drag on empty workspace space to select a group. Use the lock on
              an image to exclude it from batch renaming. Animated images are
              unsupported in this release.
            </p>
            <p className="setting-help">
              {desktop
                ? "Desktop engine: Rust · All processing stays local."
                : "Browser preview: WebP, JPEG and PNG use local browser encoding. Native AVIF and advanced lossless controls are available in the Tauri desktop app."}
            </p>
          </SimpleDialog>
        )}
      </div>
    </Sheet>
  );
}
function SimpleDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal className="dialog" label={title} onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
          autoFocus
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </Modal>
  );
}
