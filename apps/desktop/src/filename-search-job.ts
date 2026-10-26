import type { FilenameMatch, MatchOptions, SearchImage } from "./match-replace";

export interface SearchResult {
  matches: FilenameMatch[];
  error: string;
}

// Terminating the entire worker also interrupts regexes stuck inside RegExp.
export function startFilenameSearch(
  images: SearchImage[],
  options: MatchOptions,
  complete: (result: SearchResult) => void,
) {
  let worker: Worker | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const finish = (matches: FilenameMatch[], error = "") => {
    if (finished) return;
    finished = true;
    worker?.terminate();
    clearTimeout(timeout);
    complete({ matches, error });
  };
  const debounce = setTimeout(() => {
    try {
      worker = new Worker(
        new URL("./filename-search.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (
        event: MessageEvent<{ matches?: FilenameMatch[]; error?: string }>,
      ) => finish(event.data.matches ?? [], event.data.error);
      worker.onerror = () =>
        finish([], "Unable to search filenames. Count matches to retry.");
      timeout = setTimeout(
        () =>
          finish(
            [],
            "Pattern took too long. Simplify it and count matches again.",
          ),
        2000,
      );
      worker.postMessage({ images, options });
    } catch {
      finish([], "Unable to start filename search. Count matches to retry.");
    }
  }, 180);
  return () => {
    finished = true;
    clearTimeout(debounce);
    clearTimeout(timeout);
    worker?.terminate();
  };
}
