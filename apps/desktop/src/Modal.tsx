import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
export default function Modal({
  children,
  label,
  onClose,
  className = "",
  locked = false,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
  locked?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
      disablePointerDismissal={locked}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="base-backdrop" />
        <Dialog.Popup className={`base-popup ${className}`} aria-label={label}>
          {children}
          <Dialog.Close className="sr-only" disabled={locked}>
            Close dialog
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
