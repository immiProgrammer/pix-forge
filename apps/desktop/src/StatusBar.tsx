import { bytes } from "./model";

interface Props {
  scanning: boolean;
  imageCount: number;
  selectedCount: number;
  issueCount: number;
  onShowIssues: () => void;
  totalBytes: number;
  processedBytes: number;
  resultCount: number;
}

export default function StatusBar({
  scanning,
  imageCount,
  selectedCount,
  issueCount,
  onShowIssues,
  totalBytes,
  processedBytes,
  resultCount,
}: Props) {
  return (
    <footer className="status-bar">
      <div>
        <span className={`status-dot ${scanning ? "scanning" : ""}`} />
        <span>
          {scanning
            ? "Scanning images…"
            : imageCount
              ? "Workspace ready"
              : "Ready"}
        </span>
        <i />
        <span>{imageCount} images</span>
        {selectedCount > 0 && (
          <>
            <i />
            <span>{selectedCount} selected</span>
          </>
        )}
        {issueCount > 0 && (
          <button className="issue-link" onClick={onShowIssues}>
            {issueCount} import notices
          </button>
        )}
      </div>
      <div>
        {imageCount > 0 && (
          <span>
            {bytes(totalBytes)} original
            {processedBytes > 0
              ? ` · ${bytes(processedBytes)} previewed (${resultCount}/${imageCount})`
              : ""}
          </span>
        )}
      </div>
    </footer>
  );
}
