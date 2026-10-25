export type PerformanceMode = "low-memory" | "balanced" | "maximum-speed";
export interface PerformanceOptions {
  mode: PerformanceMode;
  workerLimit: number | null;
  memoryLimitMiB: number | null;
}
export const defaultPerformance: PerformanceOptions = {
  mode: "balanced",
  workerLimit: null,
  memoryLimitMiB: null,
};
function limit(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : null;
}
export function normalizePerformance(value: unknown): PerformanceOptions {
  const options =
    value && typeof value === "object"
      ? (value as Partial<PerformanceOptions>)
      : {};
  return {
    mode:
      options.mode === "low-memory" || options.mode === "maximum-speed"
        ? options.mode
        : "balanced",
    workerLimit: limit(options.workerLimit, 1, 64),
    memoryLimitMiB: limit(options.memoryLimitMiB, 128, 65536),
  };
}
export function parseWorkerLimit(value: string) {
  return limit(Number(value), 1, 64);
}
export function parseMemoryLimit(value: string) {
  return limit(Number(value) * 1024, 128, 65536);
}
