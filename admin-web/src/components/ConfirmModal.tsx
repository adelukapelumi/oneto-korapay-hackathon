import type { ReactNode } from "react";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className="modal">
        <div className="modal-header">
          <p className="auth-eyebrow">Confirmation required</p>
          <h3 id="confirm-modal-title">{title}</h3>
          <p className="modal-subtitle">Review the details below before continuing.</p>
        </div>
        <div className="modal-body-scroll">
          <div className="modal-body">{body}</div>
        </div>
        <div className="modal-actions modal-actions-sticky">
          <button type="button" className="secondary" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
