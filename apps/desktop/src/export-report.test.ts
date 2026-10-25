import { describe, it, expect } from "vitest";
import { sizeChange, summarizeOutputs } from "./export-report";
import type { ExportedImage } from "./export-report";
const image = (
  id: string,
  inputBytes: number,
  outputBytes: number,
  inputPath = "Catalog/shoes/photo.png",
  outputPath = "Prepared/shoes/photo.webp",
): ExportedImage => ({ id, inputBytes, outputBytes, inputPath, outputPath });
describe("actual export size summaries", () => {
  it("calculates a weighted batch reduction from byte totals", () => {
    const result = summarizeOutputs([
      image("a", 1000, 500),
      image("b", 100, 100),
    ]);
    expect(result).toMatchObject({
      inputBytes: 1100,
      outputBytes: 600,
      savedBytes: 500,
    });
    expect(sizeChange(result.inputBytes, result.outputBytes)).toBe(
      "45.5% reduction",
    );
  });
  it("groups each source and destination folder pair without merging distinct roots", () => {
    const result = summarizeOutputs([
      image("a", 100, 50),
      image("b", 200, 100, "Other/shoes/b.png", "Prepared-2/shoes/b.webp"),
      image("c", 300, 150),
    ]);
    expect(result.folders).toHaveLength(2);
    expect(result.folders[0]).toMatchObject({
      inputFolder: "Catalog/shoes",
      outputFolder: "Prepared/shoes",
      inputBytes: 400,
      outputBytes: 200,
    });
    expect(result.folders[0].images.map((a) => a.id)).toEqual(["a", "c"]);
  });
  it("handles Windows source paths and renamed/suffixed output paths", () => {
    const result = summarizeOutputs([
      image(
        "a",
        100,
        80,
        "C:\\Photos\\Shoes\\source.png",
        "Export/shoes/renamed-1.webp",
      ),
    ]);
    expect(result.folders[0]).toMatchObject({
      inputFolder: "C:/Photos/Shoes",
      outputFolder: "Export/shoes",
    });
    expect(result.folders[0].images[0].outputPath).toBe(
      "Export/shoes/renamed-1.webp",
    );
  });
  it("reports growth and unchanged files without negative savings percentages", () => {
    expect(sizeChange(100, 120)).toBe("20.0% larger");
    expect(sizeChange(100, 100)).toBe("0.0% reduction");
    expect(summarizeOutputs([image("a", 100, 120)]).savedBytes).toBe(-20);
  });
  it("handles zero successful exports and zero-sized sources without NaN", () => {
    expect(summarizeOutputs([])).toEqual({
      inputBytes: 0,
      outputBytes: 0,
      savedBytes: 0,
      folders: [],
    });
    expect(sizeChange(0, 0)).toBe("No change");
    expect(sizeChange(0, 10)).toBe("Size increased");
  });
});
