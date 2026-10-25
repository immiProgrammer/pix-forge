import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseDestination, exportAssets } from "./bridge";
import { defaultSettings } from "./model";
import type { Asset } from "./model";
const sourceFile = new File(
  [new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])],
  "photo.png",
  { type: "image/png", lastModified: 123 },
);
const asset: Asset = {
  id: "stable-id",
  sourcePath: "Catalog/shoes/photo.png",
  relativeFolder: "shoes",
  rootId: "root",
  rootName: "Catalog",
  originalName: "photo.png",
  stem: "photo",
  format: "png",
  width: 100,
  height: 50,
  bytes: sourceFile.size,
  thumbnail: "",
  excluded: false,
  file: sourceFile,
};
const settings = { ...defaultSettings, format: "original" as const };
let files: Map<string, File>;
let removed: string[];
let written: string[];
let onWrite: (path: string) => void;
let failPath: string | undefined;
function directory(prefix = ""): FileSystemDirectoryHandle {
  return {
    name: prefix || "Output",
    async getDirectoryHandle(name: string) {
      return directory([prefix, name].filter(Boolean).join("/"));
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const path = [prefix, name].filter(Boolean).join("/");
      if (!files.has(path)) {
        if (!options?.create)
          throw new DOMException("Missing", "NotFoundError");
        files.set(path, new File([], name));
      }
      return {
        async getFile() {
          return files.get(path)!;
        },
        async createWritable() {
          let blob: Blob | undefined;
          return {
            async write(value: Blob) {
              if (path === failPath) throw new Error("Disk is full");
              blob = value;
              onWrite(path);
            },
            async close() {
              files.set(path, new File([blob!], name));
              written.push(path);
            },
            async abort() {},
          };
        },
      };
    },
    async removeEntry(name: string) {
      const path = [prefix, name].filter(Boolean).join("/");
      files.delete(path);
      removed.push(path);
    },
  } as unknown as FileSystemDirectoryHandle;
}
beforeEach(async () => {
  files = new Map();
  removed = [];
  written = [];
  onWrite = () => {};
  failPath = undefined;
  vi.stubGlobal("window", { showDirectoryPicker: async () => directory() });
  await chooseDestination();
});
afterEach(() => vi.unstubAllGlobals());
const run = (
  assets: Asset[] = [asset],
  collision: "suffix" | "skip" | "replace" = "suffix",
  signal = new AbortController().signal,
  sources = assets,
) =>
  exportAssets(
    assets,
    settings,
    "Output",
    "",
    {},
    collision,
    () => {},
    signal,
    sources,
  );
describe("filesystem export protocol", () => {
  it("preserves roots and nested folders, and copies exact original bytes", async () => {
    const before = await sourceFile.arrayBuffer();
    const result = await run();
    expect(result.completed).toBe(1);
    expect(result.outputs).toEqual([
      {
        id: asset.id,
        inputPath: asset.sourcePath,
        outputPath: "Catalog/shoes/photo.png",
        inputBytes: sourceFile.size,
        outputBytes: sourceFile.size,
      },
    ]);
    expect(written).toEqual(["Catalog/shoes/photo.png"]);
    expect(await files.get(written[0])!.arrayBuffer()).toEqual(before);
    expect(await sourceFile.arrayBuffer()).toEqual(before);
  });
  it("adds a suffix to both existing and planned collisions", async () => {
    files.set("Catalog/shoes/photo.png", new File(["old"], "photo.png"));
    const result = await run([asset, { ...asset, id: "another-id" }]);
    expect(result.completed).toBe(2);
    expect(written).toEqual([
      "Catalog/shoes/photo-1.png",
      "Catalog/shoes/photo-2.png",
    ]);
    expect(result.outputs?.map((o) => o.outputPath)).toEqual(written);
    expect(await files.get("Catalog/shoes/photo.png")!.text()).toBe("old");
  });
  it("reports skipped files as completed progress without overwriting", async () => {
    files.set("Catalog/shoes/photo.png", new File(["old"], "photo.png"));
    const result = await run([asset], "skip");
    expect(result).toMatchObject({
      completed: 0,
      failed: 0,
      skipped: 1,
      done: true,
    });
    expect(written).toEqual([]);
    expect(result.outputs).toEqual([]);
  });
  it("replaces an unrelated existing file when explicitly requested", async () => {
    files.set(
      "Catalog/shoes/photo.png",
      new File(["old"], "photo.png", { lastModified: 456 }),
    );
    expect((await run([asset], "replace")).completed).toBe(1);
    expect(await files.get("Catalog/shoes/photo.png")!.arrayBuffer()).toEqual(
      await sourceFile.arrayBuffer(),
    );
  });
  it("protects source files, including imported files outside the export selection", async () => {
    files.set("Catalog/shoes/photo.png", sourceFile);
    const selected = {
      ...asset,
      id: "selected",
      file: new File(["other"], "other.png"),
    };
    const result = await run(
      [selected],
      "replace",
      new AbortController().signal,
      [asset, selected],
    );
    expect(result.failed).toBe(1);
    expect(Object.values(result.failures!)[0]).toContain("source file");
    expect(written).toEqual([]);
    expect(files.get("Catalog/shoes/photo.png")).toBe(sourceFile);
  });
  it("keeps finished files and removes incomplete new files after cancellation", async () => {
    const abort = new AbortController();
    onWrite = (path) => {
      if (path.includes("second")) abort.abort();
    };
    const result = await run(
      [asset, { ...asset, id: "second", stem: "second" }],
      "suffix",
      abort.signal,
    );
    expect(result).toMatchObject({ completed: 1, cancelled: true });
    expect(result.outputs?.map((o) => o.id)).toEqual([asset.id]);
    expect(files.has("Catalog/shoes/photo.png")).toBe(true);
    expect(files.has("Catalog/shoes/second.png")).toBe(false);
    expect(removed).toContain("Catalog/shoes/second.png");
  });
  it("cleans failed temporary output and returns retryable IDs and individual errors", async () => {
    failPath = "Catalog/shoes/photo.png";
    const result = await run();
    expect(result.failedIds).toEqual(["stable-id"]);
    expect(result.outputs).toEqual([]);
    expect(result.failures?.["stable-id"]).toContain("Disk is full");
    expect(files.has(failPath)).toBe(false);
  });
  it("rejects unsafe output plans before creating any file", async () => {
    await expect(run([{ ...asset, stem: "../escape" }])).rejects.toThrow(
      "unsafe",
    );
    expect(files.size).toBe(0);
  });
});
