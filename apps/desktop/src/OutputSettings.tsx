import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  Folder,
  Layers2,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { AppCheckbox, AppSelect, AppSwitch } from "./Controls";
import { SheetClose } from "./Sheet";
import PerformanceSettings from "./PerformanceSettings";
import { defaultPerformance } from "./performance";
import type { PerformanceOptions } from "./performance";
import { bytes, defaultSettings } from "./model";
import type { Format, Settings } from "./model";
import { desktop } from "./bridge";
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

interface Props {
  settings: Settings;
  changeSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  applySettings: (next: Settings) => void;
  performance: PerformanceOptions;
  setPerformance: (next: PerformanceOptions) => void;
  compact: boolean;
  busy: boolean;
  destination: string;
  pickDestination: () => Promise<void>;
  imageCount: number;
  selectedCount: number;
  totalBytes: number;
  scanning: boolean;
  onExport: () => void;
}

export default function OutputSettings({
  settings,
  changeSetting,
  applySettings,
  performance,
  setPerformance,
  compact,
  busy,
  destination,
  pickDestination,
  imageCount,
  selectedCount,
  totalBytes,
  scanning,
  onExport,
}: Props) {
  return (
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
          disabled={!desktop || busy}
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
            {imageCount ? `${imageCount} images` : "No images imported"}
          </span>
          <span>{imageCount ? bytes(totalBytes) : "✦"}</span>
        </div>
        <button
          className="primary export-button"
          disabled={!imageCount || scanning}
          onClick={onExport}
        >
          <ArrowDownToLine size={17} />
          {selectedCount ? `Export ${selectedCount} selected` : "Export images"}
          <ArrowRight size={16} />
        </button>
      </div>
    </aside>
  );
}
