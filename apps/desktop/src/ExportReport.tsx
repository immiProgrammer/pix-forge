import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Folder } from "lucide-react";
import { bytes } from "./model";
import { sizeChange, summarizeOutputs } from "./export-report";
import type { ExportedImage } from "./export-report";
export default function ExportReport({
  outputs,
}: {
  outputs: ExportedImage[];
}) {
  const summary = summarizeOutputs(outputs);
  const [expanded, setExpanded] = useState(new Set<number>());
  const [limits, setLimits] = useState<Record<number, number>>({});
  return (
    <section className="export-report" aria-label="Export size comparison">
      <h3>Input → output</h3>
      <div className="size-summary">
        <div>
          <span>INPUT IMAGES</span>
          <strong>{bytes(summary.inputBytes)}</strong>
        </div>
        <ArrowRight size={18} />
        <div>
          <span>EXPORTED IMAGES</span>
          <strong>{bytes(summary.outputBytes)}</strong>
        </div>
        <div className={summary.savedBytes < 0 ? "growth" : "savings"}>
          <span>
            {summary.savedBytes < 0 ? "SIZE INCREASE" : "SPACE SAVED"}
          </span>
          <strong>{bytes(Math.abs(summary.savedBytes))}</strong>
          <small>{sizeChange(summary.inputBytes, summary.outputBytes)}</small>
        </div>
      </div>
      <p className="report-note">
        Actual sizes for {outputs.length} successfully saved images. Skipped,
        failed, and unprocessed images are excluded. Folder totals include these
        image files only.
      </p>
      <div className="report-heading">
        <span>FOLDER / IMAGE</span>
        <span>INPUT</span>
        <span>OUTPUT</span>
        <span>CHANGE</span>
      </div>
      {summary.folders.map((folder, index) => (
        <div
          className="report-folder"
          key={JSON.stringify([folder.inputFolder, folder.outputFolder])}
        >
          <button
            className="folder-summary"
            aria-expanded={expanded.has(index)}
            onClick={() =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                return next;
              })
            }
          >
            <span>
              {expanded.has(index) ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
              <Folder size={15} />
              <span
                className="selectable-text"
                title={`${folder.inputFolder} → ${folder.outputFolder}`}
              >
                <strong>{folder.inputFolder}</strong>
                <small>
                  → {folder.outputFolder} · {folder.images.length} images
                </small>
              </span>
            </span>
            <span>{bytes(folder.inputBytes)}</span>
            <span>{bytes(folder.outputBytes)}</span>
            <span
              className={
                folder.outputBytes > folder.inputBytes ? "growth" : "savings"
              }
            >
              {sizeChange(folder.inputBytes, folder.outputBytes)}
            </span>
          </button>
          {expanded.has(index) && (
            <>
              <div className="report-images">
                {folder.images.slice(0, limits[index] ?? 50).map((image) => (
                  <div className="report-image" key={image.id}>
                    <span title={`${image.inputPath} → ${image.outputPath}`}>
                      <strong>
                        {image.inputPath
                          .replaceAll("\\", "/")
                          .split("/")
                          .at(-1)}
                      </strong>
                      <small>→ {image.outputPath.split("/").at(-1)}</small>
                    </span>
                    <span>{bytes(image.inputBytes)}</span>
                    <span>{bytes(image.outputBytes)}</span>
                    <span
                      className={
                        image.outputBytes > image.inputBytes
                          ? "growth"
                          : "savings"
                      }
                    >
                      {sizeChange(image.inputBytes, image.outputBytes)}
                    </span>
                  </div>
                ))}
              </div>
              {folder.images.length > (limits[index] ?? 50) && (
                <button
                  className="report-more"
                  onClick={() =>
                    setLimits((l) => ({ ...l, [index]: (l[index] ?? 50) + 50 }))
                  }
                >
                  Show 50 more images
                </button>
              )}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
