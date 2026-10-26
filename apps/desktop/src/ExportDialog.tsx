import type { Dispatch, SetStateAction } from "react";
import {
  ArrowDownToLine,
  ChevronRight,
  Folder,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import Modal from "./Modal";
import ExportReport from "./ExportReport";
import { AppSelect } from "./Controls";
import { desktop, revealDestination } from "./bridge";
import type { Collision, Progress } from "./bridge";
import type { Asset } from "./model";

interface Props {
  assets: Asset[];
  selected: Set<string>;
  progress?: Progress;
  busy: boolean;
  exportScope: "all" | "selected";
  setExportScope: (scope: "all" | "selected") => void;
  destination: string;
  pickDestination: () => Promise<void>;
  subfolder: string;
  setSubfolder: (value: string) => void;
  rootList: [string, string][];
  roots: Record<string, string>;
  setRoots: Dispatch<SetStateAction<Record<string, string>>>;
  collision: Collision;
  setCollision: (value: Collision) => void;
  duplicatePaths: number;
  paths: string[];
  planErrors: string[];
  exportError: string;
  exportTargets: Asset[];
  startExport: (retry?: boolean) => Promise<void>;
  onClose: () => void;
  onCancel: () => void;
}

export default function ExportDialog({
  assets,
  selected,
  progress,
  busy,
  exportScope,
  setExportScope,
  destination,
  pickDestination,
  subfolder,
  setSubfolder,
  rootList,
  roots,
  setRoots,
  collision,
  setCollision,
  duplicatePaths,
  paths,
  planErrors,
  exportError,
  exportTargets,
  startExport,
  onClose,
  onCancel,
}: Props) {
  return (
    <Modal
      className={`dialog export-dialog ${progress?.done ? "export-finished" : ""}`}
      label="Review export"
      onClose={() => onClose()}
      locked={busy}
    >
      <header>
        <div>
          <span className="eyebrow">EXPORT</span>
          <h2>{progress?.done ? "Export results" : "Review export"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close export"
          disabled={busy}
          onClick={() => onClose()}
          autoFocus
        >
          <X size={20} />
        </button>
      </header>
      {!progress?.done && (
        <>
          <p className="dialog-intro">
            Your originals stay right where they are. We’ll save the new files
            below.
          </p>
          <label className="field-label">
            Images to export
            <AppSelect<"all" | "selected">
              label="Images to export"
              value={exportScope}
              disabled={busy}
              onValueChange={setExportScope}
              options={[
                { value: "all", label: `All images (${assets.length})` },
                {
                  value: "selected",
                  label: `Selected images (${selected.size})`,
                  disabled: !selected.size,
                },
              ]}
            />
          </label>
          <label className="field-label">
            Destination
            <button
              className="destination-picker"
              disabled={busy}
              onClick={() => void pickDestination()}
            >
              <Folder size={18} />
              <span>{destination || "Choose an output folder"}</span>
              <ChevronRight size={15} />
            </button>
          </label>
          <label className="field-label">
            Create a folder inside destination{" "}
            <span className="muted">(optional)</span>
            <input
              value={subfolder}
              disabled={busy}
              placeholder="e.g. website-ready"
              onChange={(e) => setSubfolder(e.target.value)}
            />
          </label>
          {rootList.length > 0 && (
            <details>
              <summary>
                Imported root folders <span>{rootList.length}</span>
              </summary>
              <p className="setting-help">
                These names appear in your output structure. Give duplicate
                roots unique names.
              </p>
              {rootList.map(([id, name]) => (
                <label key={id} className="root-rename">
                  {name}
                  <input
                    aria-label={`Export root ${name} ${id}`}
                    disabled={busy}
                    value={roots[id] ?? name}
                    onChange={(e) =>
                      setRoots((r) => ({ ...r, [id]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </details>
          )}
          <label className="field-label">
            If an output file already exists
            <AppSelect<Collision>
              label="Existing file handling"
              value={collision}
              disabled={busy}
              onValueChange={setCollision}
              options={[
                {
                  value: "suffix",
                  label: "Add suffix — keep both files (recommended)",
                },
                { value: "skip", label: "Skip — keep the existing file" },
                {
                  value: "replace",
                  label: "Replace — overwrite the existing file",
                },
              ]}
            />
          </label>
          {duplicatePaths > 0 && (
            <div className="warning-note">
              {duplicatePaths} duplicate output paths.{" "}
              {collision === "replace"
                ? "Use Add suffix or rename conflicting images."
                : "Your collision choice will be applied."}
            </div>
          )}
          <div className="path-preview">
            <span>OUTPUT PREVIEW</span>
            {paths.slice(0, 3).map((path, i) => (
              <code key={`${path}${i}`}>
                <Folder size={12} />
                {subfolder ? `${subfolder}/` : ""}
                {path}
              </code>
            ))}
            {paths.length > 3 && (
              <small>+ {paths.length - 3} more images</small>
            )}
          </div>
          {planErrors.length > 0 && (
            <div className="error-note">
              {planErrors.slice(0, 4).map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}
        </>
      )}
      {progress && (
        <div className="export-progress" aria-live="polite">
          <div>
            {busy && <LoaderCircle className="spin" size={17} />}
            <strong>
              {progress.done
                ? progress.cancelled
                  ? "Export cancelled"
                  : progress.failed
                    ? "Export finished with errors"
                    : "Export complete"
                : "Preparing your images…"}
            </strong>
            <span>
              {progress.completed + progress.failed + (progress.skipped || 0)} /{" "}
              {progress.total}
            </span>
          </div>
          <progress
            value={
              progress.completed + progress.failed + (progress.skipped || 0)
            }
            max={progress.total}
          />
          <p>
            {progress.completed} saved · {progress.failed} failed
            {progress.skipped ? ` · ${progress.skipped} skipped` : ""}
            {progress.cancelled ? " · Completed files were kept." : ""}
          </p>
          {busy && <small>{progress.current}</small>}
          {progress.failures && Object.keys(progress.failures).length > 0 && (
            <ul className="issue-list">
              {Object.entries(progress.failures).map(([id, error]) => (
                <li key={id}>
                  {assets.find((a) => a.id === id)?.originalName}: {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {progress?.done && progress.outputs && progress.outputs.length > 0 && (
        <ExportReport outputs={progress.outputs} />
      )}
      {exportError && <div className="error-note">{exportError}</div>}
      <footer>
        {progress?.done ? (
          <>
            <button onClick={() => onClose()}>Back to workspace</button>
            {progress.failed > 0 && (
              <button onClick={() => void startExport(true)}>
                Retry failed images
              </button>
            )}
            {desktop && progress.completed > 0 && (
              <button
                className="primary"
                onClick={() => void revealDestination(destination)}
              >
                <Folder size={16} /> Open output folder
              </button>
            )}
          </>
        ) : busy ? (
          <button onClick={() => onCancel()}>Cancel export</button>
        ) : (
          <>
            <span className="safe-note">
              <ShieldCheck size={14} /> Originals protected
            </span>
            <button
              className="primary"
              disabled={
                !destination ||
                !exportTargets.length ||
                !!planErrors.length ||
                (duplicatePaths > 0 && collision === "replace")
              }
              onClick={() => void startExport()}
            >
              <ArrowDownToLine size={16} /> Export {exportTargets.length} images
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}
