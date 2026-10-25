import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { exportAssets } from "./bridge";
import { defaultSettings } from "./model";
import type { Asset } from "./model";
import { defaultPerformance } from "./performance";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
beforeEach(() => vi.clearAllMocks());

describe("desktop export performance", () => {
  const asset = { id: "image", stem: "product" } as Asset;
  it("sends execution preferences separately from image settings", async () => {
    const performance = {
      mode: "maximum-speed" as const,
      workerLimit: 12,
      memoryLimitMiB: 8192,
    };
    await exportAssets(
      [asset],
      defaultSettings,
      "output",
      "",
      {},
      "suffix",
      () => {},
      new AbortController().signal,
      [asset],
      performance,
    );
    expect(invoke).toHaveBeenCalledWith(
      "export_images",
      expect.objectContaining({ settings: defaultSettings, performance }),
    );
    expect(defaultSettings).not.toHaveProperty("mode");
  });
  it("keeps old callers using Balanced Auto", async () => {
    await exportAssets(
      [asset],
      defaultSettings,
      "output",
      "",
      {},
      "suffix",
      () => {},
      new AbortController().signal,
    );
    expect(invoke).toHaveBeenCalledWith(
      "export_images",
      expect.objectContaining({ performance: defaultPerformance }),
    );
  });
});
