import { X } from "lucide-react";
import Modal from "./Modal";

export default function SimpleDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal className="dialog" label={title} onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
          autoFocus
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </Modal>
  );
}
