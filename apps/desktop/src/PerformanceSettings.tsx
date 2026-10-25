import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { AppSelect } from "./Controls";
import { parseMemoryLimit, parseWorkerLimit } from "./performance";
import type { PerformanceMode, PerformanceOptions } from "./performance";

export default function PerformanceSettings({
  value,
  onChange,
  disabled,
  native,
}: {
  value: PerformanceOptions;
  onChange: (next: PerformanceOptions) => void;
  disabled: boolean;
  native: boolean;
}) {
  const [workers, setWorkers] = useState(value.workerLimit?.toString() ?? "");
  const [memory, setMemory] = useState(
    value.memoryLimitMiB === null ? "" : String(value.memoryLimitMiB / 1024),
  );
  useEffect(
    () => setWorkers(value.workerLimit?.toString() ?? ""),
    [value.workerLimit],
  );
  useEffect(
    () =>
      setMemory(
        value.memoryLimitMiB === null
          ? ""
          : String(value.memoryLimitMiB / 1024),
      ),
    [value.memoryLimitMiB],
  );
  return (
    <section className="setting-section performance-settings">
      <div className="section-label">
        <Gauge size={15} aria-hidden="true" />
        <h3>Export performance</h3>
      </div>
      <AppSelect<PerformanceMode>
        label="Export performance mode"
        value={value.mode}
        disabled={disabled}
        onValueChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: "low-memory", label: "Low memory" },
          { value: "balanced", label: "Balanced" },
          { value: "maximum-speed", label: "Maximum speed" },
        ]}
      />
      <p className="setting-help">
        {!native
          ? "Parallel export is available in the desktop app."
          : value.mode === "maximum-speed"
            ? "Uses more available RAM and CPU to process more images at once."
            : value.mode === "low-memory"
              ? "Runs fewer images at once to keep memory usage lower."
              : "Automatically balances speed with available RAM and CPU."}
      </p>
      <div className="performance-limits">
        <label htmlFor="export-worker-limit">
          Worker limit
          <input
            id="export-worker-limit"
            type="number"
            min="1"
            max="64"
            step="1"
            placeholder="Auto"
            value={workers}
            disabled={disabled}
            onChange={(event) => setWorkers(event.target.value)}
            onBlur={() => {
              const workerLimit = parseWorkerLimit(workers);
              setWorkers(workerLimit?.toString() ?? "");
              onChange({ ...value, workerLimit });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <label htmlFor="export-memory-limit">
          RAM budget (GB)
          <input
            id="export-memory-limit"
            type="number"
            min="0.125"
            max="64"
            step="0.125"
            placeholder="Auto"
            value={memory}
            disabled={disabled}
            onChange={(event) => setMemory(event.target.value)}
            onBlur={() => {
              const memoryLimitMiB = parseMemoryLimit(memory);
              setMemory(
                memoryLimitMiB === null ? "" : String(memoryLimitMiB / 1024),
              );
              onChange({ ...value, memoryLimitMiB });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </div>
      <p className="setting-help">
        Leave limits blank for Auto. Applies to the next export; image quality
        stays the same.
      </p>
    </section>
  );
}
