import { useEffect, useState } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import { cardImage } from "./bridge";
import type { CardSource } from "./bridge";
import type { Asset } from "./model";

export default function CardImage({
  asset,
  onSourceChange,
}: {
  asset: Asset;
  onSourceChange: (id: string, source: CardSource) => void;
}) {
  const [fallback, setFallback] = useState(/^(tif|tiff)$/i.test(asset.format));
  const [source, setSource] = useState<string | undefined>(asset.thumbnail);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSource(asset.thumbnail);
    setFallback(/^(tif|tiff)$/i.test(asset.format));
  }, [asset.id, asset.sourceVersion, asset.format]);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setLoading(fallback);
    void cardImage(asset, fallback, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setSource(result.url);
        onSourceChange(asset.id, result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [asset.id, asset.sourceVersion, fallback, onSourceChange]);

  return (
    <>
      <img
        src={source}
        alt={asset.originalName}
        loading="eager"
        decoding="async"
        draggable={false}
        onLoad={() => setLoading(false)}
        onError={() => {
          if (!source) return;
          if (!fallback) setFallback(true);
          else {
            setSource(undefined);
            setLoading(false);
            setError(true);
          }
        }}
      />
      {(loading || error) && (
        <span
          className="card-image-feedback"
          role={error ? "status" : undefined}
        >
          {error ? (
            <>
              <ImageOff size={17} aria-hidden="true" /> Preview unavailable
            </>
          ) : (
            <LoaderCircle
              size={18}
              className="spin"
              aria-label="Loading image"
            />
          )}
        </span>
      )}
    </>
  );
}
