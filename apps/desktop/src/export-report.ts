export interface ExportedImage {
  id: string;
  inputPath: string;
  outputPath: string;
  inputBytes: number;
  outputBytes: number;
}
export function sizeChange(input: number, output: number) {
  if (input === 0) return output === 0 ? "No change" : "Size increased";
  const rate = ((input - output) / input) * 100;
  return rate < 0
    ? `${Math.abs(rate).toFixed(1)}% larger`
    : `${rate.toFixed(1)}% reduction`;
}
export function summarizeOutputs(outputs: ExportedImage[]) {
  const folders = new Map<
    string,
    {
      inputFolder: string;
      outputFolder: string;
      inputBytes: number;
      outputBytes: number;
      images: ExportedImage[];
    }
  >();
  let inputBytes = 0,
    outputBytes = 0;
  for (const image of outputs) {
    inputBytes += image.inputBytes;
    outputBytes += image.outputBytes;
    const parent = (path: string) =>
      path.replaceAll("\\", "/").split("/").slice(0, -1).join("/") ||
      "Loose images";
    const inputFolder = parent(image.inputPath),
      outputFolder = parent(image.outputPath),
      key = JSON.stringify([inputFolder, outputFolder]);
    const folder = folders.get(key) ?? {
      inputFolder,
      outputFolder,
      inputBytes: 0,
      outputBytes: 0,
      images: [],
    };
    folder.inputBytes += image.inputBytes;
    folder.outputBytes += image.outputBytes;
    folder.images.push(image);
    folders.set(key, folder);
  }
  return {
    inputBytes,
    outputBytes,
    savedBytes: inputBytes - outputBytes,
    folders: [...folders.values()],
  };
}
