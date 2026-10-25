import { useEffect, useRef, useState } from "react";
import type { Processed } from "./model";

interface ImagePair {
  assetId: string;
  original: string;
  processed: string;
  ownsProcessed: boolean;
}
function dispose(pair?: ImagePair) {
  if (pair?.ownsProcessed) URL.revokeObjectURL(pair.processed);
}
async function decodeImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
}

/** Reveal a decoded pair atomically; retain a ready pair during same-image encoding. */
export function useComparisonImages(
  assetId: string,
  original: string,
  processed?: Processed,
) {
  const [pair, setPair] = useState<ImagePair>();
  const shown = useRef<ImagePair | undefined>(undefined);
  const [failure, setFailure] = useState<{
    assetId: string;
    url: string;
    message: string;
  }>();
  useEffect(() => {
    if (!original || !processed) return;
    let active = true;
    const candidate: ImagePair = {
      assetId,
      original,
      processed: processed.blob
        ? URL.createObjectURL(processed.blob)
        : processed.url,
      ownsProcessed: !!processed.blob,
    };
    void Promise.all([
      decodeImage(candidate.original),
      decodeImage(candidate.processed),
    ])
      .then(() => {
        if (!active) return;
        const previous = shown.current;
        shown.current = candidate;
        setPair(candidate);
        setFailure(undefined);
        dispose(previous);
      })
      .catch(() => {
        if (active)
          setFailure({
            assetId,
            url: processed.url,
            message:
              "Could not load the comparison images. Reopen this image to retry.",
          });
      });
    return () => {
      active = false;
      if (shown.current !== candidate) dispose(candidate);
    };
  }, [assetId, original, processed?.url]);
  useEffect(
    () => () => {
      dispose(shown.current);
      shown.current = undefined;
    },
    [],
  );
  return {
    images: pair?.assetId === assetId ? pair : undefined,
    error:
      failure?.assetId === assetId && failure.url === processed?.url
        ? failure.message
        : undefined,
  };
}
