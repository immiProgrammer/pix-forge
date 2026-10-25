import { describe, expect, it } from "vitest";
import {
  defaultPerformance,
  normalizePerformance,
  parseMemoryLimit,
  parseWorkerLimit,
} from "./performance";

describe("saved export performance preferences", () => {
  it("restores safe automatic defaults for absent or invalid values", () => {
    expect(normalizePerformance(null)).toEqual(defaultPerformance);
    expect(
      normalizePerformance({
        mode: "gpu",
        workerLimit: "8",
        memoryLimitMiB: -1,
      }),
    ).toEqual(defaultPerformance);
    expect(
      normalizePerformance({ workerLimit: Infinity, memoryLimitMiB: NaN }),
    ).toEqual(defaultPerformance);
  });
  it("preserves presets and explicit limits", () => {
    expect(
      normalizePerformance({
        mode: "maximum-speed",
        workerLimit: 12,
        memoryLimitMiB: 8192,
      }),
    ).toEqual({ mode: "maximum-speed", workerLimit: 12, memoryLimitMiB: 8192 });
    expect(
      normalizePerformance({
        mode: "low-memory",
        workerLimit: 500,
        memoryLimitMiB: 1,
      }),
    ).toEqual({ mode: "low-memory", workerLimit: 64, memoryLimitMiB: 128 });
  });
  it("clears optional limits back to Auto and converts GB to MiB", () => {
    expect(parseWorkerLimit("")).toBeNull();
    expect(parseWorkerLimit("0")).toBeNull();
    expect(parseWorkerLimit("4.9")).toBe(4);
    expect(parseMemoryLimit("")).toBeNull();
    expect(parseMemoryLimit("2.5")).toBe(2560);
    expect(parseMemoryLimit("-4")).toBeNull();
    expect(parseMemoryLimit("bad")).toBeNull();
    expect(parseMemoryLimit("1000")).toBe(65536);
  });
});
