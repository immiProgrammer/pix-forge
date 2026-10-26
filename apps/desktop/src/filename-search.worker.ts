import { matchFilenames } from "./match-replace";
import type { MatchOptions, SearchImage } from "./match-replace";

self.onmessage = (
  event: MessageEvent<{ images: SearchImage[]; options: MatchOptions }>,
) => {
  try {
    self.postMessage({
      matches: matchFilenames(event.data.images, event.data.options),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
