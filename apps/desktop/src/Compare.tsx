import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Columns2,
  LoaderCircle,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { originalPreview } from "./bridge";
import { bytes, reduction } from "./model";
import { sizeChange } from "./export-report";
import type { Asset, Processed } from "./model";
import { useRetainedPreview } from "./useRetainedPreview";
import { useComparisonImages } from "./useComparisonImages";
import { initialCompareView, zoomCompareView } from "./compare-view";
export default function Compare({
  asset,
  format,
  result,
  error,
  onClose,
  onNavigate,
  index,
  total,
  settingsControl,
}: {
  asset: Asset;
  format: string;
  result?: Processed;
  error?: string;
  onClose: () => void;
  onNavigate: (direction: number) => void;
  index: number;
  total: number;
  settingsControl: ReactNode;
}) {
  const [mode, setMode] = useState<"side" | "slider">("slider");
  const [view, setView] = useState(initialCompareView);
  const { zoom } = view;
  const [divider, setDivider] = useState(50);
  const [originalSource, setOriginal] = useState<{
    assetId: string;
    url: string;
  }>();
  const original =
    originalSource?.assetId === asset.id ? originalSource.url : "";
  const retainedResult = useRetainedPreview(asset.id, result);
  const { images, error: loadingError } = useComparisonImages(
    asset.id,
    original,
    retainedResult,
  );
  const previewError = error || loadingError;
  const surface = useRef<HTMLDivElement>(null);
  const comparison = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const fit = Math.max(
    0.001,
    Math.min(
      (size.width / (mode === "side" ? 2 : 1) - 64) / asset.width,
      (size.height - 64) / asset.height,
    ),
  );
  const geometry = {
    width: asset.width,
    height: asset.height,
    viewportWidth: size.width / (mode === "side" ? 2 : 1),
    viewportHeight: size.height,
    fit,
  };
  const { pan } = view;
  const scale = fit * zoom;
  useEffect(() => {
    setView(initialCompareView);
    setOriginal(undefined);
    let active = true;
    let source = "";
    void originalPreview(asset)
      .then((url) => {
        source = url;
        if (active) setOriginal({ assetId: asset.id, url });
        else if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setOriginal({ assetId: asset.id, url: asset.thumbnail });
      });
    return () => {
      active = false;
      if (source.startsWith("blob:")) URL.revokeObjectURL(source);
    };
  }, [asset.id, asset.sourceVersion]);
  useEffect(() => {
    const observer = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,.ui-select-positioner,.ui-select-trigger,.ui-checkbox,.ui-switch,.ui-popover-positioner,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (e.key === "Escape") onClose();
      if (!comparison.current?.contains(target)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onNavigate(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onNavigate(1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNavigate]);
  const reset = () => {
    setView(initialCompareView);
  };
  const zoomBy = (factor: number) => {
    drag.current = null;
    setView((current) =>
      zoomCompareView(current, current.zoom * factor, geometry),
    );
  };
  const image = (url: string) =>
    url ? (
      <img
        src={url}
        alt=""
        draggable={false}
        style={{
          width: asset.width * scale,
          height: asset.height * scale,
          transform: `translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px))`,
        }}
      />
    ) : null;
  return (
    <section
      ref={comparison}
      className="compare-dialog inline-compare"
      aria-label={`Compare ${asset.originalName}`}
      aria-busy={(!result || !images) && !previewError}
    >
      <header className="compare-header">
        <div>
          <h2 title={`${asset.stem}.${format}`}>
            {asset.stem}
            <span>.{format}</span>
          </h2>
        </div>
        <div className="toolbar-group toolbar-right">
          <div className="segmented">
            <button
              aria-label="Side by side"
              title="Side by side"
              className={mode === "side" ? "active" : ""}
              onClick={() => {
                setMode("side");
                reset();
              }}
            >
              <Columns2 size={15} />{" "}
              <span className="compare-mode-label">Side by side</span>
            </button>
            <button
              aria-label="Slider"
              title="Slider"
              className={mode === "slider" ? "active" : ""}
              onClick={() => {
                setMode("slider");
                reset();
              }}
            >
              <SplitSquareHorizontal size={15} />{" "}
              <span className="compare-mode-label">Slider</span>
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Back to files"
            title="Back to files (Esc)"
            onClick={onClose}
            autoFocus
          >
            <X size={19} />
          </button>
          {settingsControl}
        </div>
      </header>
      <div
        ref={surface}
        tabIndex={0}
        aria-label="Comparison image canvas"
        className={`compare-surface checker ${mode}`}
        onWheel={(e) => {
          zoomBy(Math.exp(-e.deltaY * 0.001));
        }}
        onPointerDown={(e) => {
          if (!images) return;
          if (
            (e.target as HTMLElement).closest(
              ".compare-divider,.preview-message",
            )
          )
            return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          const origin = drag.current;
          if (origin)
            setView((current) => ({
              ...current,
              pan: {
                x: origin.px + e.clientX - origin.x,
                y: origin.py + e.clientY - origin.y,
              },
            }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {mode === "side" ? (
          <>
            <div className="compare-pane">{image(images?.original || "")}</div>
            <div className="compare-pane">{image(images?.processed || "")}</div>
          </>
        ) : (
          <>
            <div className="compare-layer">{image(images?.original || "")}</div>
            <div
              className="compare-layer"
              style={{ clipPath: `inset(0 0 0 ${divider}%)` }}
            >
              {image(images?.processed || "")}
            </div>
            <div
              className="compare-divider"
              style={{
                left: `${divider}%`,
                visibility: images ? "visible" : "hidden",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  const rect = surface.current!.getBoundingClientRect();
                  setDivider(
                    Math.max(
                      0,
                      Math.min(
                        100,
                        ((e.clientX - rect.left) / rect.width) * 100,
                      ),
                    ),
                  );
                }
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
            >
              <input
                type="range"
                min={0}
                max={100}
                value={divider}
                aria-label="Comparison divider"
                disabled={!images}
                onChange={(e) => setDivider(+e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
              />
              <span>‹ ›</span>
            </div>
          </>
        )}
        {(!result || !images || previewError) && (
          <div className="preview-feedback">
            <div
              className={`preview-message ${previewError ? "preview-error" : ""}`}
              role={previewError ? "alert" : "status"}
              aria-live="polite"
            >
              {!previewError && (
                <LoaderCircle size={17} className="spin" aria-hidden="true" />
              )}
              <span>
                {previewError ||
                  (result ? "Loading comparison…" : "Encoding preview…")}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="compare-tools">
        <div>
          <button
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.25)}
          >
            <Minus size={16} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.25)}
          >
            <Plus size={16} />
          </button>
          <i />
          <button onClick={reset}>
            <Maximize size={14} /> Fit
          </button>
          <button
            onClick={() => {
              setView({ zoom: 1 / fit, pan: { x: 0, y: 0 } });
            }}
          >
            100%
          </button>
          <button className="icon-button" title="Reset view" onClick={reset}>
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="compare-summary">
          <span className="compare-metadata selectable-text">
            <span aria-label="Input size and dimensions">
              {bytes(asset.bytes)} · {asset.width} × {asset.height}
            </span>
            <span aria-hidden="true">→</span>
            <span aria-label="Output size and dimensions">
              {result
                ? `${bytes(result.bytes)} · ${result.width} × ${result.height}`
                : error
                  ? "Failed"
                  : "Encoding…"}{" "}
              · {format.toUpperCase()}
            </span>
          </span>
          <span
            className={`compare-reduction ${result && result.bytes > asset.bytes ? "growth" : "savings"}`}
          >
            {result
              ? result.bytes > asset.bytes
                ? reduction(asset.bytes, result.bytes)
                : sizeChange(asset.bytes, result.bytes)
              : "Result size available after encoding"}
          </span>
        </div>
        <div>
          <button
            className="icon-button"
            aria-label="Previous image"
            disabled={index === 0}
            onClick={() => onNavigate(-1)}
          >
            <ArrowLeft size={16} />
          </button>
          <span>
            {index + 1} / {total}
          </span>
          <button
            className="icon-button"
            aria-label="Next image"
            disabled={index === total - 1}
            onClick={() => onNavigate(1)}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
