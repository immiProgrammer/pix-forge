import { describe, expect, it } from "vitest";
import { aiRenamePrompt, renameManifest, reviewAiMapping } from "./ai-renaming";
import { defaultSettings, snapshot, restore } from "./model";
import type { Asset } from "./model";

const asset = (id: string, overrides: Partial<Asset> = {}): Asset => ({
  id,
  sourcePath: `C:/catalog/shoes/${id}.png`,
  relativeFolder: "shoes",
  rootId: "catalog-root",
  rootName: "catalog",
  originalName: `${id}.png`,
  stem: id,
  format: "png",
  width: 200,
  height: 100,
  bytes: 123,
  thumbnail: "",
  excluded: false,
  ...overrides,
});
const assets = [
  asset("red"),
  asset("blue"),
  asset("locked", { excluded: true }),
];
const target = new Set(assets.map((asset) => asset.id));
const manifest = renameManifest(assets, target, defaultSettings);
const review = (json: string) =>
  reviewAiMapping(json, manifest, assets, defaultSettings);

describe("AI rename prompt", () => {
  it("includes only a compact source-path list without repeated metadata", () => {
    const prompt = aiRenamePrompt(manifest, {
      base: "folder",
      product: "",
      instructions: "",
    });
    const list = prompt.split("Files (2):\n")[1];
    expect(list).toBe('["catalog/shoes/red.png","catalog/shoes/blue.png"]');
    expect(prompt).not.toContain('"currentName"');
    expect(prompt).not.toContain('"parentFolder"');
    expect(prompt).not.toContain('"path":');
    expect(prompt).toContain(
      '"exact list item":"newNameWithoutFolderPathAndWithoutExtension"',
    );
    expect(prompt).not.toContain("None.");
  });
  it("uses source paths independently of current output names and omits excluded images", () => {
    expect(manifest.map((entry) => entry.path)).toEqual([
      "catalog/shoes/red.png",
      "catalog/shoes/blue.png",
    ]);
    expect(
      renameManifest(
        [asset("red", { stem: "manually-edited" })],
        target,
        defaultSettings,
      )[0],
    ).toMatchObject({
      path: "catalog/shoes/red.png",
      currentName: "manually-edited.webp",
      parentFolder: "shoes",
    });
  });
  it("allows an empty custom product name and defaults to slugification without inventing details", () => {
    const prompt = aiRenamePrompt(manifest, {
      base: "custom",
      product: "  ",
      instructions: "",
    });
    expect(prompt).toContain("No shared product name");
    expect(prompt).toContain("By default, slugify");
    expect(prompt).toContain("colors, sizes");
    expect(prompt).toContain("WhatsApp, Screenshot");
    expect(prompt).toContain("do not invent product details");
    expect(prompt).not.toContain("catalog/shoes/locked.png");
  });
  it("supports folder or custom bases and additional formatting instructions", () => {
    expect(
      aiRenamePrompt(manifest, {
        base: "folder",
        product: "ignored",
        instructions: "Keep underscores.",
      }),
    ).toContain("immediate parent folder");
    const prompt = aiRenamePrompt(manifest, {
      base: "custom",
      product: "Summer shoes",
      instructions: "Keep underscores.",
    });
    expect(prompt).toContain('"Summer shoes"');
    expect(prompt).toContain("Keep underscores.");
    expect(prompt).toContain("Follow different formatting instructions");
  });
  it("rejects ambiguous source paths rather than mapping an image twice", () => {
    expect(() =>
      renameManifest(
        [asset("red"), asset("other", { originalName: "red.png" })],
        new Set(["red", "other"]),
        defaultSettings,
      ),
    ).toThrow("More than one image");
  });
});
describe("AI mapping validation", () => {
  it("matches by path in any order, reviews in display order, and preserves excluded files", () => {
    const plan = review(
      '{"catalog/shoes/blue.png":"summer-blue","catalog/shoes/red.png":"summer-red"}',
    );
    expect(plan.changes.map((change) => change.id)).toEqual(["red", "blue"]);
    expect(plan.next.map((asset) => asset.stem)).toEqual([
      "summer-red",
      "summer-blue",
      "locked",
    ]);
    expect(plan.next.map((asset) => asset.sourcePath)).toEqual(
      assets.map((asset) => asset.sourcePath),
    );
    expect(restore(plan.next, snapshot(assets))).toEqual(assets);
  });
  it("allows omissions and empty mappings, leaving existing names unchanged", () => {
    const plan = review('{"catalog/shoes/red.png":"summer-red"}');
    expect(plan).toMatchObject({ matched: 1, missing: 1, unchanged: 1 });
    expect(plan.next[1]).toEqual(assets[1]);
    expect(review("{}")).toMatchObject({
      matched: 0,
      missing: 2,
      unchanged: 2,
      changes: [],
    });
  });
  it("rejects unknown and excluded paths", () => {
    for (const path of ["missing.png", "catalog/shoes/locked.png"])
      expect(() => review(JSON.stringify({ [path]: "new-name" }))).toThrow(
        "Unknown or out-of-scope",
      );
  });
  it("detects duplicate keys including JSON-escaped keys", () => {
    expect(() =>
      review('{"catalog/shoes/red.png":"one","catalog/shoes/red.png":"two"}'),
    ).toThrow("Duplicate source path");
    expect(() =>
      review(
        '{"catalog/shoes/red.png":"one","catalog/shoes/\\u0072ed.png":"two"}',
      ),
    ).toThrow("Duplicate source path");
    expect(() =>
      review('{"catalog/shoes/red.png":{},"catalog/shoes/red.png":"two"}'),
    ).toThrow("filename string");
  });
  it.each([
    "",
    "not json",
    "[]",
    "null",
    '{"catalog/shoes/red.png":123}',
    '{"catalog/shoes/red.png":{"name":"red"}}',
  ])("rejects malformed or non-flat responses: %s", (input) =>
    expect(() => review(input)).toThrow(),
  );
  it.each(["", "CON", "../red", "red/42", "bad.", "red.webp"])(
    "rejects invalid output stems: %s",
    (stem) =>
      expect(() =>
        review(JSON.stringify({ "catalog/shoes/red.png": stem })),
      ).toThrow(),
  );
  it("detects collisions against unchanged names case-insensitively", () => {
    expect(() => review('{"catalog/shoes/red.png":"BLUE"}')).toThrow(
      "Conflicting output path",
    );
  });
  it("preserves valid Unicode and custom formatting instead of applying an unwanted slug", () => {
    expect(
      review('{"catalog/shoes/red.png":"夏_赤_42"}').changes[0].after,
    ).toBe("夏_赤_42");
  });
  it("accepts a single JSON code block from an AI tool", () => {
    expect(
      review('```json\n{"catalog/shoes/red.png":"summer-red"}\n```').changes,
    ).toHaveLength(1);
  });
});
