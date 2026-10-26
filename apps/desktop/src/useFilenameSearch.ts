import { useEffect, useMemo, useState } from "react";
import { nextMatchId } from "./match-replace";
import { startFilenameSearch } from "./filename-search-job";
import type { FilenameMatch, MatchOptions, SearchImage } from "./match-replace";

export function useFilenameSearch(
  images: SearchImage[],
  options: MatchOptions,
) {
  const signature = JSON.stringify({ images, options });
  const [revision, setRevision] = useState(0);
  const request = `${revision}:${signature}`;
  const [result, setResult] = useState<{
    request: string;
    matches: FilenameMatch[];
    error: string;
  }>();
  const [activeId, setActiveId] = useState<string>();
  useEffect(() => {
    if (!options.query) return;
    return startFilenameSearch(images, options, (result) => {
      setResult({ request, ...result });
      setActiveId((current) =>
        result.matches.some((m) => m.id === current)
          ? current
          : result.matches[0]?.id,
      );
    });
  }, [request]);
  const current =
    options.query && result?.request === request ? result : undefined;
  const matches = current?.matches ?? [];
  const ids = useMemo(() => matches.map((m) => m.id), [matches]);
  return {
    matches,
    activeId: ids.includes(activeId ?? "") ? activeId : undefined,
    error: current?.error ?? "",
    pending: !!options.query && !current,
    navigate: (direction: number) =>
      setActiveId((currentId) => nextMatchId(ids, currentId, direction)),
    refresh: () => setRevision((r) => r + 1),
  };
}
