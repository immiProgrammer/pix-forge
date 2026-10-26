import { describe, expect, it } from "vitest";
import { matchFilenames, nextMatchId, replacementPlan } from "./match-replace";
import type { MatchOptions } from "./match-replace";
import { defaultSettings, restore, snapshot } from "./model";
import type { Asset } from "./model";

const image = (
  id: string,
  stem = id,
  overrides: Partial<Asset> = {},
): Asset => ({
  id,
  stem,
  originalName: `${id}.png`,
  sourcePath: `/source/${id}.png`,
  relativeFolder: "shoes",
  rootId: "root",
  rootName: "catalog",
  format: "png",
  width: 100,
  height: 100,
  bytes: 2000,
  thumbnail: "",
  excluded: false,
  ...overrides,
});
const options = (overrides: Partial<MatchOptions> = {}): MatchOptions => ({
  query: "shoe",
  replacement: "boot",
  regex: false,
  caseSensitive: true,
  ...overrides,
});

describe("filename matching", () => {
  it("counts matching images once, replaces every occurrence, and preserves order", () => {
    const matches = matchFilenames(
      [image("1", "shoe-shoe"), image("2", "hat"), image("3", "shoe")],
      options(),
    );
    expect(matches.map((m) => [m.id, m.after])).toEqual([
      ["1", "boot-boot"],
      ["3", "boot"],
    ]);
  });
  it("treats literal query and replacement metacharacters as text", () => {
    expect(
      matchFilenames(
        [image("1", "[a].*-x-[a].*")],
        options({ query: "[a].*", replacement: "$1-$&-$$" }),
      )[0].after,
    ).toBe("$1-$&-$$-x-$1-$&-$$");
  });
  it("removes matched text with an empty replacement", () => {
    expect(
      matchFilenames(
        [image("1", "shoe-blue-shoe")],
        options({ replacement: "" }),
      )[0].after,
    ).toBe("-blue-");
  });
  it("does not search or rename with a blank Match, in either mode", () => {
    for (const regex of [false, true])
      expect(
        matchFilenames(
          [image("1")],
          options({ query: "", replacement: "new", regex }),
        ),
      ).toEqual([]);
  });
  it("supports case-insensitive matching without leaking regex state across images", () => {
    const images = [image("1", "Shoe"), image("2", "shoe"), image("3", "shoe")];
    expect(matchFilenames(images, options()).map((m) => m.id)).toEqual([
      "2",
      "3",
    ]);
    expect(
      matchFilenames(images, options({ caseSensitive: false })).map(
        (m) => m.id,
      ),
    ).toEqual(["1", "2", "3"]);
  });
  it("preserves Unicode product text and supports named and positional captures", () => {
    expect(
      matchFilenames(
        [image("1", "حذاء-blue-42")],
        options({
          regex: true,
          query: "(?<color>blue)-(\\d+)",
          replacement: "$2-$<color>",
        }),
      )[0].after,
    ).toBe("حذاء-42-blue");
  });
  it("supports regex match and escaped dollar replacement tokens", () => {
    expect(
      matchFilenames(
        [image("1", "shoe")],
        options({ regex: true, replacement: "$$-$&" }),
      )[0].after,
    ).toBe("$-shoe");
  });
  it("handles zero-width matches without splitting Unicode surrogate pairs", () => {
    expect(
      matchFilenames(
        [image("1", "😀x")],
        options({ regex: true, query: "(?:)", replacement: "_" }),
      )[0].after,
    ).toBe("_😀_x_");
    expect(
      matchFilenames(
        [image("1", "shoe")],
        options({ regex: true, query: "^", replacement: "new-" }),
      )[0].after,
    ).toBe("new-shoe");
  });
  it("reports invalid expressions and returns an empty set for no matches", () => {
    expect(() =>
      matchFilenames([image("1")], options({ regex: true, query: "[" })),
    ).toThrow();
    expect(matchFilenames([image("1", "hat")], options())).toEqual([]);
  });
  it("finds excluded images but retains their exclusion status", () => {
    expect(
      matchFilenames([image("1", "shoe", { excluded: true })], options())[0]
        .excluded,
    ).toBe(true);
  });
});

describe("replacement export plan", () => {
  it("renames only supplied matches and leaves excluded assets and source data untouched", () => {
    const assets = [
      image("1", "shoe"),
      image("2", "shoe", { excluded: true, relativeFolder: "other" }),
      image("3", "hat"),
    ];
    const before = structuredClone(assets);
    const plan = replacementPlan(
      assets,
      matchFilenames(assets, options()),
      defaultSettings,
      {},
    );
    expect(plan.count).toBe(1);
    expect(plan.errors).toEqual([]);
    expect(plan.assets[0]).toEqual({ ...before[0], stem: "boot" });
    expect(plan.assets[1]).toBe(assets[1]);
    expect(plan.assets[2]).toBe(assets[2]);
    expect(assets).toEqual(before);
  });
  it("allows identical names in different directories", () => {
    const assets = [
      image("1", "shoe-red"),
      image("2", "shoe-blue", { relativeFolder: "hats" }),
    ];
    const matches = matchFilenames(
      assets,
      options({ regex: true, query: ".+", replacement: "product" }),
    );
    expect(
      replacementPlan(assets, matches, defaultSettings, {}).errors,
    ).toEqual([]);
  });
  it("detects case-insensitive collisions with unchanged images", () => {
    const assets = [image("1", "shoe"), image("2", "BOOT")];
    expect(
      replacementPlan(
        assets,
        matchFilenames(assets, options()),
        defaultSettings,
        {},
      ).errors.join(),
    ).toContain("Conflicting output path");
  });
  it.each(["", "CON", "bad/name", "bad\\name", "bad.", " ", "x".repeat(241)])(
    "rejects invalid replacement filename %j",
    (replacement) => {
      const assets = [image("1", "shoe")];
      expect(
        replacementPlan(
          assets,
          matchFilenames(assets, options({ replacement })),
          defaultSettings,
          {},
        ).errors.length,
      ).toBeGreaterThan(0);
    },
  );
  it("rejects stale names, exclusions, and removed assets", () => {
    const original = [image("1", "shoe")];
    const matches = matchFilenames(original, options());
    for (const assets of [
      [image("1", "manual-name")],
      [image("1", "shoe", { excluded: true })],
      [],
    ]) {
      expect(
        replacementPlan(assets, matches, defaultSettings, {}).errors.join(),
      ).toContain("changed");
    }
  });
  it("counts matched-but-unchanged names as no operation", () => {
    const assets = [image("1", "shoe")];
    const matches = matchFilenames(assets, options({ replacement: "shoe" }));
    expect(matches).toHaveLength(1);
    expect(replacementPlan(assets, matches, defaultSettings, {}).count).toBe(0);
  });
  it("supports selected-scope replacements and current-only replacement", () => {
    const assets = [image("1", "shoe-red"), image("2", "shoe-blue")];
    const selected = new Set(["2"]);
    const matches = matchFilenames(
      assets.filter((a) => selected.has(a.id)),
      options(),
    );
    expect(
      replacementPlan(assets, matches, defaultSettings, {}).assets.map(
        (a) => a.stem,
      ),
    ).toEqual(["shoe-red", "boot-blue"]);
    expect(
      replacementPlan(
        assets,
        matchFilenames(assets, options()).slice(0, 1),
        defaultSettings,
        {},
      ).assets.map((a) => a.stem),
    ).toEqual(["boot-red", "shoe-blue"]);
    expect([...selected]).toEqual(["2"]);
  });
  it("restores a whole batch and its exclusions from one naming snapshot", () => {
    const assets = [image("1", "shoe-red"), image("2", "shoe-blue")];
    const before = snapshot(assets);
    const plan = replacementPlan(
      assets,
      matchFilenames(assets, options()),
      defaultSettings,
      {},
    );
    const after = snapshot(plan.assets);
    expect(restore(plan.assets, before)).toEqual(assets);
    expect(restore(restore(plan.assets, before), after)).toEqual(plan.assets);
  });
});

describe("find navigation", () => {
  it("moves in display order, wraps, and handles one or no result", () => {
    expect(nextMatchId(["a", "b", "c"], "a", 1)).toBe("b");
    expect(nextMatchId(["a", "b", "c"], "c", 1)).toBe("a");
    expect(nextMatchId(["a", "b", "c"], "a", -1)).toBe("c");
    expect(nextMatchId(["a"], "a", 1)).toBe("a");
    expect(nextMatchId([], "a", 1)).toBeUndefined();
  });
  it("chooses an endpoint if the active image was removed", () => {
    expect(nextMatchId(["a", "b"], "removed", 1)).toBe("a");
    expect(nextMatchId(["a", "b"], undefined, -1)).toBe("b");
  });
});
