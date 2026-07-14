import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { ModalFrame } from './ModalFrame'

export type ConfirmationDialogProps = {
  label: string
  title: string
  message: ReactNode
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  destructive?: boolean
  restoreFocusFallback?: () => HTMLElement | null
}

export function ConfirmationDialog({
  label,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = true,
  restoreFocusFallback,
}: ConfirmationDialogProps) {
  const confirm = () => {
    onConfirm()
    if (!restoreFocusFallback) return
    window.setTimeout(() => {
      const target = restoreFocusFallback()
      if (target?.isConnected && document.activeElement === document.body) target.focus({ preventScroll: true })
    }, 0)
  }

  return (
    <ModalFrame
      label={label}
      onClose={onCancel}
      closeOnBackdrop={false}
      dialogClassName="manager-modal confirmation-dialog"
      restoreFocusFallback={restoreFocusFallback}
    >
      <div className="confirmation-dialog-heading">
        <span className={`confirmation-dialog-icon${destructive ? ' is-destructive' : ''}`} aria-hidden="true">
          <AlertTriangle size={20} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
      </div>
      <div className="confirmation-dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={destructive ? 'danger-button confirmation-dialog-confirm' : 'primary-action'}
          onClick={confirm}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalFrame>
  )
}
