import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  dimensions,
  extension,
  invalidStem,
  outputPath,
  reduction,
  rename,
  restore,
  slugify,
  snapshot,
  validatePlan,
} from "./model";
import type { Asset } from "./model";
import { intersectingIndices, previewIds } from "./model";
const asset = (
  id: string,
  folder = "shoes",
  overrides: Partial<Asset> = {},
): Asset => ({
  id,
  rootId: "root",
  rootName: "catalog",
  sourcePath: `/catalog/${folder}/${id}.png`,
  relativeFolder: folder,
  originalName: `${id}.png`,
  stem: id,
  format: "png",
  width: 2400,
  height: 1200,
  bytes: 10000,
  thumbnail: "",
  excluded: false,
  ...overrides,
});
const options = { custom: "summer", start: 7, padding: 3, separator: "-" };
describe("naming export plan", () => {
  it("restarts folder sequences independently and retains display order", () => {
    const a = [asset("a"), asset("b", "hats"), asset("c")];
    expect(
      rename(a, new Set(["a", "b", "c"]), "folder", options).map((a) => a.stem),
    ).toEqual(["shoes-007", "hats-007", "shoes-008"]);
  });
  it("uses one custom sequence across targeted images only", () => {
    const a = [asset("a"), asset("b"), asset("c")];
    expect(
      rename(a, new Set(["a", "c"]), "custom", options).map((a) => a.stem),
    ).toEqual(["summer-007", "b", "summer-008"]);
  });
  it("skips exclusions without consuming numbers", () => {
    const a = [asset("a", "shoes", { excluded: true }), asset("b")];
    expect(
      rename(a, new Set(["a", "b"]), "custom", options).map((a) => a.stem),
    ).toEqual(["a", "summer-007"]);
  });
  it("does not implicitly protect manually edited stems", () => {
    expect(
      rename(
        [asset("a", "shoes", { stem: "edited" })],
        new Set(["a"]),
        "custom",
        options,
      )[0].stem,
    ).toBe("summer-007");
  });
  it("restores names and exclusions while preserving source metadata and newly imported images", () => {
    const original = [asset("a")];
    const before = snapshot(original);
    const changed = [
      asset("a", "shoes", { stem: "new", excluded: true }),
      asset("b"),
    ];
    expect(
      restore(changed, before).map((a) => [a.id, a.stem, a.excluded]),
    ).toEqual([
      ["a", "a", false],
      ["b", "b", false],
    ]);
    expect(restore(changed, before)[0].sourcePath).toBe(original[0].sourcePath);
  });
  it("preserves meaningful Unicode and strips unsafe punctuation", () => {
    expect(slugify("  Summer Photo 01!! ")).toBe("summer-photo-01");
    expect(slugify("夏の 写真 / café")).toBe("夏の-写真-café");
    expect(slugify("اردو تصویر")).toBe("اردو-تصویر");
  });
  it.each([
    "",
    " ",
    "../oops",
    "a/b",
    "a\\b",
    "CON",
    "NUL.txt",
    "LPT1",
    "bad.",
    "bad ",
    ":bad",
    "a\x00b",
  ])("rejects unsafe stem %j", (name) =>
    expect(invalidStem(name)).toBeTruthy(),
  );
  it("accepts safe Unicode names", () =>
    expect(invalidStem("写真-café-001")).toBeUndefined());
  it("keeps root and nested paths separate from output stems", () =>
    expect(outputPath(asset("a"), defaultSettings, { root: "new-root" })).toBe(
      "new-root/shoes/a.webp",
    ));
  it("requires duplicate imported root names to be resolved explicitly", () => {
    const a = [asset("a"), asset("b", "shoes", { rootId: "other" })];
    expect(validatePlan(a, defaultSettings, {})).toHaveLength(1);
    expect(validatePlan(a, defaultSettings, { other: "catalog-2" })).toEqual(
      [],
    );
  });
  it("changes extension independently of name", () => {
    expect(extension(asset("a"), { ...defaultSettings, format: "jpeg" })).toBe(
      "jpeg",
    );
    expect(
      extension(asset("a"), { ...defaultSettings, format: "original" }),
    ).toBe("png");
  });
});
describe("dimensions and actual byte statistics", () => {
  it("does not process newly imported files until a preview is requested", () => {
    const assets = Array.from({ length: 10 }, (_, i) => asset(String(i)));
    expect(previewIds(assets, new Set(), undefined, new Set(), false)).toEqual(
      [],
    );
    expect(
      previewIds(assets, new Set(), undefined, new Set(["7"]), false),
    ).toEqual(["7"]);
    expect(previewIds(assets, new Set(), "9", new Set(), false)).toEqual(["9"]);
    const captured = new Set(previewIds(assets, new Set(["6"])));
    expect(
      previewIds(
        [...assets, asset("later")],
        captured,
        undefined,
        new Set(),
        false,
      ),
    ).toEqual(["6", "0", "1", "2"]);
  });
  it("previews only selected items, the first three and the open comparison", () => {
    const assets = Array.from({ length: 10 }, (_, i) => asset(String(i)));
    expect(previewIds(assets, new Set())).toEqual(["0", "1", "2"]);
    expect(previewIds(assets, new Set(["1", "7", "removed"]), "9")).toEqual([
      "9",
      "1",
      "7",
      "0",
      "2",
    ]);
  });
  it("skips the first-three sample with at least three valid selected images", () => {
    const assets = Array.from({ length: 10 }, (_, i) => asset(String(i)));
    expect(previewIds(assets, new Set(["5", "6", "7"]))).toEqual([
      "5",
      "6",
      "7",
    ]);
    expect(previewIds(assets, new Set(["5", "6", "7", "8"]), "9")).toEqual([
      "9",
      "5",
      "6",
      "7",
      "8",
    ]);
  });
  it("does not count manual preview requests as selected images", () => {
    const assets = Array.from({ length: 10 }, (_, i) => asset(String(i)));
    expect(
      previewIds(assets, new Set(), undefined, new Set(["5", "6", "7"])),
    ).toEqual(["5", "6", "7", "0", "1", "2"]);
  });
  it("selects a partial overlap entirely inside a card", () => {
    expect(
      intersectingIndices(6, 3, 258, 690, {
        left: 260,
        right: 270,
        top: 30,
        bottom: 40,
      }),
    ).toEqual([1]);
  });
  it("uses compact list spacing for overlap without selecting the gap", () => {
    expect(
      intersectingIndices(
        10,
        1,
        68,
        700,
        {
          left: 20,
          right: 25,
          top: 62,
          bottom: 63,
        },
        4,
      ),
    ).toEqual([0]);
    expect(
      intersectingIndices(
        10,
        1,
        68,
        700,
        {
          left: 20,
          right: 25,
          top: 65,
          bottom: 67,
        },
        4,
      ),
    ).toEqual([]);
  });
  it("selects virtual rows beyond the rendered viewport", () => {
    const indices = intersectingIndices(1000, 3, 258, 700, {
      left: 0,
      right: 700,
      top: 0,
      bottom: 2580,
    });
    expect(indices).toHaveLength(30);
    expect(indices.at(-1)).toBe(29);
  });
  it("ignores card gaps and clips to the actual collection", () => {
    expect(
      intersectingIndices(2, 3, 258, 690, {
        left: 600,
        right: 650,
        top: 0,
        bottom: 250,
      }),
    ).toEqual([]);
    expect(
      intersectingIndices(3, 1, 78, 700, {
        left: 0,
        right: 700,
        top: 63,
        bottom: 77,
      }),
    ).toEqual([]);
  });
  it("fits within both limits with preserved aspect ratio", () =>
    expect(
      dimensions(2400, 1200, {
        ...defaultSettings,
        resize: true,
        maxWidth: "1000",
        maxHeight: "400",
      }),
    ).toEqual({ width: 800, height: 400 }));
  it("handles one unbounded dimension", () =>
    expect(
      dimensions(2400, 1200, {
        ...defaultSettings,
        resize: true,
        maxHeight: "300",
      }),
    ).toEqual({ width: 600, height: 300 }));
  it("prevents upscaling by default", () =>
    expect(
      dimensions(100, 50, {
        ...defaultSettings,
        resize: true,
        maxWidth: "1000",
      }),
    ).toEqual({ width: 100, height: 50 }));
  it("allows explicit upscaling", () =>
    expect(
      dimensions(100, 50, {
        ...defaultSettings,
        resize: true,
        maxWidth: "1000",
        upscale: true,
      }),
    ).toEqual({ width: 1000, height: 500 }));
  it("ignores dormant limits when resize is disabled", () =>
    expect(dimensions(100, 50, { ...defaultSettings, maxWidth: "20" })).toEqual(
      { width: 100, height: 50 },
    ));
  it("distinguishes actual file growth from savings", () => {
    expect(reduction(1000, 750)).toBe("25.0% smaller");
    expect(reduction(1000, 1250)).toBe("Size increased by 25.0%");
  });
});
