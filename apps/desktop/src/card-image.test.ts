import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { cardImage, originalPreview } from "./bridge";
import type { Asset } from "./model";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => `asset:${path}`,
}));
const asset = {
  id: "image-id",
  sourceVersion: "old",
  sourcePath: "photo.jpg",
} as Asset;
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("comparison original", () => {
  it("displays supported sources without Rust re-encoding", async () => {
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = vi.fn().mockResolvedValue(undefined);
      },
    );
    await expect(originalPreview({ ...asset, format: "jpg" })).resolves.toBe(
      "asset:photo.jpg?v=old",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
  it("falls back to a full resolution Rust original when display decoding fails", async () => {
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = vi.fn().mockRejectedValue(new Error("Unsupported"));
      },
    );
    vi.mocked(invoke).mockResolvedValue({ cachePath: "original.png" });
    await expect(originalPreview({ ...asset, format: "avif" })).resolves.toBe(
      "asset:original.png",
    );
    expect(invoke).toHaveBeenCalledWith("source_preview", { id: asset.id });
  });
  it("uses a full resolution Rust original for TIFF", async () => {
    vi.mocked(invoke).mockResolvedValue({ cachePath: "original.png" });
    await expect(originalPreview({ ...asset, format: "tiff" })).resolves.toBe(
      "asset:original.png",
    );
  });
});

describe("on-demand card sources", () => {
  it("checks current native metadata and versions the direct image URL", async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: "photo.jpg",
      sourceVersion: "modified",
      width: 20,
      height: 30,
      bytes: 123,
      format: "jpg",
    });
    const source = await cardImage(asset, false, new AbortController().signal);
    expect(invoke).toHaveBeenCalledWith(
      "card_image",
      expect.objectContaining({ id: asset.id, fallback: false }),
    );
    expect(source).toMatchObject({
      url: "asset:photo.jpg?v=modified",
      width: 20,
      height: 30,
      sourceVersion: "modified",
    });
  });
  it("requests a native fallback only explicitly", async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: "cached.webp",
      sourceVersion: "current",
    });
    expect(
      (await cardImage(asset, true, new AbortController().signal)).url,
    ).toBe("asset:cached.webp?v=current");
    expect(invoke).toHaveBeenCalledWith(
      "card_image",
      expect.objectContaining({ fallback: true }),
    );
  });
  it("does no work for an already obsolete card", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      cardImage(asset, false, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("cancels off-screen fallback requests and discards late results", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "card_image"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    const controller = new AbortController();
    const pending = cardImage(asset, true, controller.signal);
    controller.abort();
    finish({ path: "obsolete.webp", sourceVersion: "old" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledWith("cancel_export", {
      jobId: expect.any(String),
    });
  });
});
