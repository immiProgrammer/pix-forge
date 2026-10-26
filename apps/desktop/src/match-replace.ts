import { invalidStem, outputPath } from "./model";
import type { Asset, Settings } from "./model";

export interface MatchOptions {
  query: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
}
export type SearchImage = Pick<Asset, "id" | "stem" | "excluded">;
export interface FilenameMatch {
  id: string;
  before: string;
  after: string;
  excluded: boolean;
}
export function matchFilenames(
  images: SearchImage[],
  options: MatchOptions,
): FilenameMatch[] {
  if (!options.query) return [];
  const pattern = options.regex
    ? options.query
    : options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(pattern, options.caseSensitive ? "gu" : "giu");
  return images.flatMap((image) => {
    expression.lastIndex = 0;
    if (!expression.test(image.stem)) return [];
    expression.lastIndex = 0;
    const after = options.regex
      ? image.stem.replace(expression, options.replacement)
      : image.stem.replace(expression, () => options.replacement);
    return [
      { id: image.id, before: image.stem, after, excluded: image.excluded },
    ];
  });
}
export function nextMatchId(
  ids: string[],
  current: string | undefined,
  direction: number,
) {
  if (!ids.length) return undefined;
  const index = current ? ids.indexOf(current) : -1;
  if (index < 0) return direction < 0 ? ids.at(-1) : ids[0];
  return ids[(index + (direction % ids.length) + ids.length) % ids.length];
}
export function replacementPlan(
  assets: Asset[],
  matches: FilenameMatch[],
  settings: Settings,
  roots: Record<string, string>,
) {
  const changes = new Map(
    matches
      .filter((m) => !m.excluded && m.before !== m.after)
      .map((m) => [m.id, m]),
  );
  const errors: string[] = [];
  const next = assets.map((image) => {
    const change = changes.get(image.id);
    if (!change) return image;
    if (image.excluded || image.stem !== change.before) {
      errors.push("Image names or exclusions changed. Count matches again.");
      return image;
    }
    return { ...image, stem: change.after };
  });
  const present = new Set(assets.map((a) => a.id));
  if (matches.some((m) => !present.has(m.id)))
    errors.push("The image collection changed. Count matches again.");
  const paths = new Set<string>();
  for (const image of next) {
    const invalid = invalidStem(image.stem);
    if (invalid) errors.push(`${image.originalName}: ${invalid}`);
    const path = outputPath(image, settings, roots).toLocaleLowerCase();
    if (paths.has(path))
      errors.push(
        `Conflicting output path: ${outputPath(image, settings, roots)}`,
      );
    paths.add(path);
  }
  return {
    assets: next,
    count: next.filter((a, i) => a.stem !== assets[i].stem).length,
    errors: [...new Set(errors)],
  };
}
