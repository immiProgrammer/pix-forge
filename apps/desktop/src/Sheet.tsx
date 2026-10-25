import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  children,
  suppressReturnFocus = false,
}: {
  children: ReactNode;
  suppressReturnFocus?: boolean;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop
        className="settings-sheet-overlay"
        data-slot="sheet-overlay"
      />
      <Dialog.Popup
        className="settings-sheet"
        data-slot="sheet-content"
        data-side="right"
        finalFocus={!suppressReturnFocus}
      >
        <Dialog.Title className="sr-only">Output settings</Dialog.Title>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}
