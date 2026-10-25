import { useEffect, useRef, useState } from "react";
import type { Processed } from "./model";

interface RetainedPreview {
  assetId: string;
  result: Processed;
  ownsUrl: boolean;
}

/** Keep one preview independently of the processing cache's URL lifetime. */
export function useRetainedPreview(assetId: string, result?: Processed) {
  const current = useRef<RetainedPreview | undefined>(undefined);
  const [retained, setRetained] = useState<RetainedPreview>();
  useEffect(() => {
    if (!result) return;
    const next: RetainedPreview = {
      assetId,
      result: result.blob
        ? { ...result, url: URL.createObjectURL(result.blob) }
        : result,
      ownsUrl: !!result.blob,
    };
    const previous = current.current;
    current.current = next;
    setRetained(next);
    if (previous?.ownsUrl) URL.revokeObjectURL(previous.result.url);
  }, [assetId, result]);
  useEffect(
    () => () => {
      if (current.current?.ownsUrl)
        URL.revokeObjectURL(current.current.result.url);
      current.current = undefined;
    },
    [],
  );
  return (
    result ?? (retained?.assetId === assetId ? retained.result : undefined)
  );
}
