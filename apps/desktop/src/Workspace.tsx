import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import SelectionArea from "@viselect/vanilla";
import {
  Check,
  CheckCheck,
  CircleAlert,
  ImagePlus,
  FolderPlus,
  Play,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { bytes, extension, invalidStem, intersectingIndices } from "./model";
import type { Asset, Settings, Processed } from "./model";
import { AppCheckbox } from "./Controls";
import { sizeChange } from "./export-report";
import CardImage from "./CardImage";
import type { CardSource } from "./bridge";
export function Filename({
  asset,
  ext,
  onCommit,
}: {
  asset: Asset;
  ext: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(asset.stem);
  const cancelled = useRef(false);
  useEffect(() => setDraft(asset.stem), [asset.stem]);
  return (
    <div className={`filename ${invalidStem(draft) ? "invalid" : ""}`}>
      <input
        aria-label={`Output name for ${asset.originalName}`}
        title={invalidStem(draft) || "Edit output filename"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          if (draft !== asset.stem) onCommit(draft);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(asset.stem);
            e.currentTarget.blur();
          }
        }}
      />
      <span>.{ext}</span>
    </div>
  );
}
interface Props {
  assets: Asset[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  view: "grid" | "list";
  imageFit: "fit" | "fill";
  onSourceChange: (id: string, source: CardSource) => void;
  settings: Settings;
  results: Record<string, Processed>;
  errors: Record<string, string>;
  previewing: ReadonlySet<string>;
  onRename: (id: string, name: string) => void;
  onCompare: (id: string) => void;
  onProcess: (id: string) => void;
  onExclude: (id: string) => void;
  onImport: (folder: boolean) => void;
  scanning: boolean;
  loadingCount: number;
  searchActiveId?: string;
  visible?: boolean;
}
export default function Workspace(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const selectionArea = useRef<SelectionArea | null>(null);
  const [width, setWidth] = useState(900);
  const anchor = useRef<string | undefined>(undefined);
  const selectedRef = useRef(p.selected);
  selectedRef.current = p.selected;
  const dragBase = useRef(new Set<string>());
  const dragging = useRef(false);
  const columns =
    p.view === "list" ? 1 : Math.max(1, Math.floor((width - 48) / 218));
  const rowHeight = p.view === "list" ? 68 : 258;
  const rowGap = p.view === "list" ? 4 : 16;
  const loadingCount = p.loadingCount;
  const previousLoadingCount = useRef(0);
  const layout = useRef({
    assets: p.assets,
    columns,
    rowHeight,
    rowGap,
    loadingCount,
  });
  layout.current = {
    assets: p.assets,
    columns,
    rowHeight,
    rowGap,
    loadingCount,
  };
  const virtual = useVirtualizer({
    count: Math.ceil((p.assets.length + loadingCount) / columns),
    getScrollElement: () => container.current,
    estimateSize: () => rowHeight,
    measureElement: () => rowHeight,
    directDomUpdates: true,
    useFlushSync: false,
    overscan: p.view === "list" ? 14 : 4,
  });
  const rows = virtual.getVirtualItems();
  useEffect(() => {
    if (p.visible === false || !p.searchActiveId) return;
    const index = p.assets.findIndex((asset) => asset.id === p.searchActiveId);
    if (index >= 0)
      virtual.scrollToIndex(Math.floor(index / columns), { align: "auto" });
  }, [p.searchActiveId, p.visible, p.assets, columns]);
  const visibleKey = rows.map((r) => r.index).join(",");
  useEffect(() => {
    if (loadingCount > 0 && previousLoadingCount.current === 0)
      virtual.scrollToIndex(
        Math.floor((p.assets.length + loadingCount - 1) / columns),
        { align: "end" },
      );
    previousLoadingCount.current = loadingCount;
  }, [loadingCount]);
  useEffect(() => {
    virtual.measure();
  }, [rowHeight, columns]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!container.current) return;
    const area = new SelectionArea({
      selectionAreaClass: "selection-rectangle",
      selectables: [".asset-card"],
      boundaries: [container.current],
      startAreas: [container.current],
      features: { singleTap: { allow: false }, range: false },
      behaviour: {
        startThreshold: { x: 5, y: 5 },
        intersect: "touch",
        scrolling: { speedDivider: 10, startScrollMargins: { x: 30, y: 60 } },
      },
    });
    selectionArea.current = area;
    const updateSelection = () => {
      const content = container.current?.querySelector(".virtual-content");
      if (!content) return;
      const bounds = content.getBoundingClientRect(),
        boundary = container.current!.getBoundingClientRect();
      const { x1, y1, x2, y2 } = area.getAreaLocation();
      const endX = Math.max(boundary.left, Math.min(boundary.right, x2)),
        endY = Math.max(boundary.top, Math.min(boundary.bottom, y2));
      const { assets, columns, rowHeight, rowGap, loadingCount } =
        layout.current;
      const indices = intersectingIndices(
        assets.length + loadingCount,
        columns,
        rowHeight,
        bounds.width,
        {
          left: Math.min(x1, endX) - bounds.left,
          right: Math.max(x1, endX) - bounds.left,
          top: Math.min(y1, endY) - bounds.top,
          bottom: Math.max(y1, endY) - bounds.top,
        },
        rowGap,
      );
      p.setSelected(
        new Set([
          ...dragBase.current,
          ...indices.flatMap((i) => {
            const asset = assets[i];
            return asset ? [asset.id] : [];
          }),
        ]),
      );
    };
    area
      .on("beforestart", ({ event }) => {
        const target = event?.target as HTMLElement;
        return !target?.closest(
          'input,button,a,select,textarea,[role="checkbox"],[contenteditable="true"],.import-placeholder',
        );
      })
      .on("start", ({ event }) => {
        dragging.current = true;
        dragBase.current =
          (event && (event as globalThis.MouseEvent).ctrlKey) ||
          (event && (event as globalThis.MouseEvent).metaKey)
            ? new Set(selectedRef.current)
            : new Set();
        // Clear Viselect's store silently; synthetic move/stop events here
        // would use the unfinished rectangle and end the drag prematurely.
        area.clearSelection(true, true);
      })
      .on("move", updateSelection)
      .on("stop", () => {
        updateSelection();
        setTimeout(() => {
          dragging.current = false;
        }, 0);
      });
    return () => {
      area.destroy();
      selectionArea.current = null;
    };
  }, [p.setSelected, p.view]);
  useEffect(() => {
    // Viselect resolves cards when a drag starts; only refresh during an active drag.
    if (dragging.current) selectionArea.current?.resolveSelectables();
  }, [visibleKey, p.assets]);
  const select = useCallback(
    (e: MouseEvent, id: string) => {
      if (dragging.current) return;
      if ((e.target as HTMLElement).closest('input,button,[role="checkbox"]'))
        return;
      container.current?.focus({ preventScroll: true });
      const next = new Set(p.selected);
      if (e.shiftKey && anchor.current) {
        const a = p.assets.findIndex((x) => x.id === anchor.current),
          b = p.assets.findIndex((x) => x.id === id);
        if (!e.ctrlKey && !e.metaKey) next.clear();
        for (let n = Math.min(a, b); n <= Math.max(a, b); n++)
          if (p.assets[n]) next.add(p.assets[n].id);
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
      } else {
        next.clear();
        next.add(id);
        anchor.current = id;
      }
      p.setSelected(next);
    },
    [p.assets, p.selected, p.setSelected],
  );
  return (
    <div
      ref={container}
      className={`workspace ${p.view}`}
      data-image-fit={p.imageFit}
      tabIndex={0}
      role="listbox"
      aria-multiselectable="true"
      aria-label="Image workspace"
      aria-busy={p.scanning}
      onClick={(e) => {
        if (
          !dragging.current &&
          !(e.target as HTMLElement).closest(
            ".asset-card,button,input,a,.import-placeholder",
          )
        )
          p.setSelected(new Set());
      }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input,.ui-checkbox")) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "a") {
          e.preventDefault();
          p.setSelected(new Set(p.assets.map((a) => a.id)));
        }
        if (e.key === "Escape") p.setSelected(new Set());
        if (
          ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) &&
          p.assets.length
        ) {
          e.preventDefault();
          const current = p.assets.findIndex((a) => a.id === anchor.current);
          const delta =
            e.key === "ArrowRight"
              ? 1
              : e.key === "ArrowLeft"
                ? -1
                : e.key === "ArrowDown"
                  ? columns
                  : -columns;
          const next = Math.max(
            0,
            Math.min(p.assets.length - 1, current + delta),
          );
          const id = p.assets[next].id;
          if (e.shiftKey) {
            const from = Math.max(0, current);
            const selection = new Set(p.selected);
            for (let i = Math.min(from, next); i <= Math.max(from, next); i++)
              selection.add(p.assets[i].id);
            p.setSelected(selection);
          } else p.setSelected(new Set([id]));
          anchor.current = id;
          virtual.scrollToIndex(Math.floor(next / columns));
        }
        if (e.key === "Enter" && p.selected.size === 1)
          p.onCompare([...p.selected][0]);
      }}
    >
      {!p.assets.length && !p.scanning ? (
        <div className="empty-workspace">
          <div className="empty-art" aria-hidden="true">
            <div className="mini-image back">
              <div className="mini-sun" />
              <div className="mini-mountain" />
            </div>
            <div className="mini-image front">
              <div className="mini-sun" />
              <div className="mini-mountain" />
              <span>
                <Check size={14} />
              </span>
            </div>
            <div className="art-spark one">✦</div>
            <div className="art-spark two">+</div>
          </div>
          <h2>{p.scanning ? "Finding your images…" : "No images"}</h2>
          <p>Drop images or folders here, or add them below.</p>
          <div className="empty-actions">
            <button className="primary" onClick={() => p.onImport(false)}>
              <ImagePlus size={16} /> Add images
            </button>
            <button onClick={() => p.onImport(true)}>
              <FolderPlus size={16} /> Add folder
            </button>
          </div>
          <div className="supported">
            JPG, PNG, WebP, AVIF, TIFF & more <span>·</span> Still images only
          </div>
        </div>
      ) : (
        <>
          {p.view === "list" && (
            <div className="list-heading">
              <span>IMAGE / OUTPUT NAME</span>
              <span>DIMENSIONS</span>
              <span>ORIGINAL</span>
              <span>RESULT</span>
              <span />
            </div>
          )}
          {p.scanning && (
            <span className="sr-only" role="status">
              Importing images...
            </span>
          )}
          <div ref={virtual.containerRef} className="virtual-content">
            {rows.map((row) => (
              <div
                key={row.key}
                ref={virtual.measureElement}
                data-index={row.index}
                className="virtual-row"
                style={{
                  height: rowHeight,
                  gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
                }}
              >
                <WorkspaceRow
                  p={p}
                  rowIndex={row.index}
                  columns={columns}
                  select={select}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const WorkspaceRow = memo(function WorkspaceRow({
  p,
  rowIndex,
  columns,
  select,
}: {
  p: Props;
  rowIndex: number;
  columns: number;
  select: (event: MouseEvent, id: string) => void;
}) {
  return (
    <>
      {" "}
      {Array.from(
        {
          length: Math.min(
            columns,
            p.assets.length + p.loadingCount - rowIndex * columns,
          ),
        },
        (_, column) => {
          const slot = rowIndex * columns + column;
          const asset = p.assets[slot];
          if (!asset)
            return (
              <div
                className="import-placeholder"
                aria-hidden="true"
                key={`loading-${slot}`}
              >
                <div className="import-placeholder-image">
                  <LoaderCircle className="spin" size={20} />
                </div>
                <div className="import-placeholder-name">
                  <span />
                  <small>Loading image...</small>
                </div>
              </div>
            );
          const result = p.results[asset.id],
            error = p.errors[asset.id];
          return (
            <article
              key={asset.id}
              data-id={asset.id}
              className={`asset-card ${p.selected.has(asset.id) ? "selected" : ""} ${p.searchActiveId === asset.id ? "find-active" : ""}`}
              onClick={(e) => select(e, asset.id)}
              onDoubleClick={(e) => {
                if (
                  !(e.target as HTMLElement).closest(
                    'input,button,[role="checkbox"]',
                  )
                )
                  p.onCompare(asset.id);
              }}
              aria-selected={p.selected.has(asset.id)}
              role="option"
            >
              <div className="thumbnail checker">
                <CardImage asset={asset} onSourceChange={p.onSourceChange} />
                <AppCheckbox
                  className={`select-check ${p.selected.has(asset.id) ? "checked" : ""}`}
                  label={`Select ${asset.originalName}`}
                  checked={p.selected.has(asset.id)}
                  onCheckedChange={(checked) => {
                    const next = new Set(p.selected);
                    if (checked) next.add(asset.id);
                    else next.delete(asset.id);
                    p.setSelected(next);
                  }}
                />
                <span className="format-badge">
                  {asset.format.toUpperCase()}
                </span>
                {(!result || error) &&
                  (!p.previewing.has(asset.id) || error) && (
                    <button
                      className="process-preview"
                      aria-label={`${error ? "Retry processing" : "Process"} ${asset.originalName}`}
                      title={
                        error
                          ? "Retry processing this image"
                          : "Process this image, or select it and change an output setting"
                      }
                      onClick={() => p.onProcess(asset.id)}
                    >
                      <Play size={13} />
                    </button>
                  )}
                <button
                  className={`exclude-button ${asset.excluded ? "excluded" : ""}`}
                  onClick={() => p.onExclude(asset.id)}
                  title={
                    asset.excluded
                      ? "Include in batch renaming"
                      : "Exclude from batch renaming"
                  }
                  aria-label={
                    asset.excluded
                      ? "Include in batch renaming"
                      : "Exclude from batch renaming"
                  }
                >
                  {asset.excluded ? (
                    <LockKeyhole size={13} />
                  ) : (
                    <CheckCheck size={13} />
                  )}
                </button>
              </div>
              <div className="asset-name">
                <Filename
                  asset={asset}
                  ext={extension(asset, p.settings)}
                  onCommit={(name) => p.onRename(asset.id, name)}
                />
                {p.view === "list" && (
                  <small>
                    {[asset.rootName, asset.relativeFolder]
                      .filter(Boolean)
                      .join(" / ") || "Loose images"}
                    {asset.excluded ? " · Naming excluded" : ""}
                  </small>
                )}
              </div>
              <div className="asset-dimensions">
                {asset.width} × {asset.height}
              </div>
              <div className="asset-size">{bytes(asset.bytes)}</div>
              <div
                className={`asset-result ${error ? "error" : ""}`}
                title={error || ""}
              >
                {error ? (
                  <>
                    <CircleAlert size={12} /> Processing error
                  </>
                ) : result ? (
                  <>
                    <span>{bytes(result.bytes)}</span>
                    <small
                      className={`reduction-badge ${result.bytes > asset.bytes ? "growth" : "savings"}`}
                      aria-label={`Image size change: ${sizeChange(asset.bytes, result.bytes)}`}
                    >
                      {sizeChange(asset.bytes, result.bytes)}
                    </small>
                  </>
                ) : p.previewing.has(asset.id) ? (
                  <span className="muted" role="status">
                    <LoaderCircle size={11} className="spin" /> Processing…
                  </span>
                ) : (
                  <span className="muted">Not processed</span>
                )}
              </div>
            </article>
          );
        },
      )}{" "}
    </>
  );
});
