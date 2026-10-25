import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleHelp, Copy, Minus, Square, X } from "lucide-react";
import { desktop } from "./bridge";
export default function Titlebar({
  onError,
  onHelp,
}: {
  onError: (message: string) => void;
  onHelp: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    const win = getCurrentWindow();
    let disposed = false,
      unlisten: (() => void) | undefined;
    const update = () => {
      void win
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch((e) => onError(String(e)));
    };
    update();
    void win
      .onResized(update)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => onError(String(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onError]);
  const action = (task: () => Promise<void>) => {
    if (desktop) void task().catch((e) => onError(String(e)));
  };
  return (
    <div className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region>
        <img src="/app-icon.svg" alt="" draggable={false} />
        <span>PixForge</span>
      </div>
      <div className="window-controls" aria-label="Window controls">
        <button
          title="Help & keyboard shortcuts"
          aria-label="Help & keyboard shortcuts"
          onClick={onHelp}
        >
          <CircleHelp size={16} />
        </button>
        <button
          aria-label="Minimize window"
          title="Minimize"
          disabled={!desktop}
          onClick={() => action(() => getCurrentWindow().minimize())}
        >
          <Minus size={15} />
        </button>
        <button
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
          disabled={!desktop}
          onClick={() => action(() => getCurrentWindow().toggleMaximize())}
        >
          {maximized ? <Copy size={13} /> : <Square size={12} />}
        </button>
        <button
          className="window-close"
          aria-label="Close window"
          title="Close"
          disabled={!desktop}
          onClick={() => action(() => getCurrentWindow().close())}
        >
          <X size={17} />
        </button>
      </div>
    </div>
  );
}
