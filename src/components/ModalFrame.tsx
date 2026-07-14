import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const MODAL_BASE_Z_INDEX = 1000
type ModalStackEntry = { id: string; dialog: HTMLDivElement }

let modalStack: ModalStackEntry[] = []

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const focusableElements = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  )

export const hasActiveModal = () => modalStack.length > 0

const stopModalEvent = (event: MouseEvent | PointerEvent) => {
  event.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
}

const blockModalContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
}

export type ModalFrameProps = {
  label: string
  children: ReactNode
  onClose: () => void
  backdropClassName?: string
  dialogClassName?: string
  hidden?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  onGlobalKeyDown?: (event: KeyboardEvent) => void
  restoreFocusFallback?: () => HTMLElement | null
}

export function ModalFrame({
  label,
  children,
  onClose,
  backdropClassName = 'modal-backdrop',
  dialogClassName = 'manager-modal',
  hidden = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  onGlobalKeyDown,
  restoreFocusFallback,
}: ModalFrameProps) {
  const reactId = useId()
  const idRef = useRef(`modal-${reactId}`)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [initialRestoreFocus] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const restoreFocusRef = useRef<HTMLElement | null>(initialRestoreFocus)
  const restoreFocusFallbackRef = useRef(restoreFocusFallback)
  const [depth, setDepth] = useState(0)
  const active = !hidden

  useEffect(() => {
    restoreFocusFallbackRef.current = restoreFocusFallback
  }, [restoreFocusFallback])

  useEffect(() => {
    if (active) return undefined
    const rememberFocusedElement = () => {
      const focusedElement = document.activeElement
      if (!(focusedElement instanceof HTMLElement) || backdropRef.current?.contains(focusedElement)) return
      restoreFocusRef.current = focusedElement
    }
    rememberFocusedElement()
    document.addEventListener('focusin', rememberFocusedElement, true)
    return () => document.removeEventListener('focusin', rememberFocusedElement, true)
  }, [active])

  useEffect(() => {
    if (!active) return undefined

    const id = idRef.current
    const dialog = dialogRef.current
    if (!backdropRef.current || !dialog) return undefined
    const focusedElement = document.activeElement
    if (focusedElement instanceof HTMLElement && !dialog.contains(focusedElement)) {
      restoreFocusRef.current = focusedElement
    }
    modalStack = modalStack.filter((item) => item.id !== id)
    modalStack.push({ id, dialog })
    // Modal depth is only known after registering in the shared stack.
    setDepth(modalStack.length - 1)
    if (!dialog.contains(document.activeElement)) {
      const firstFocusable = focusableElements(dialog)[0]
      ;(firstFocusable ?? dialog).focus({ preventScroll: true })
    }

    return () => {
      const wasTopModal = modalStack[modalStack.length - 1]?.id === id
      modalStack = modalStack.filter((item) => item.id !== id)
      if (!wasTopModal) return
      const expectedTopId = modalStack[modalStack.length - 1]?.id
      window.setTimeout(() => {
        if (modalStack[modalStack.length - 1]?.id !== expectedTopId) return
        const originalTarget = restoreFocusRef.current
        const fallbackTarget = restoreFocusFallbackRef.current?.()
        const lowerDialog = modalStack[modalStack.length - 1]?.dialog
        const lowerModalTarget = lowerDialog?.isConnected ? (focusableElements(lowerDialog)[0] ?? lowerDialog) : null
        const restoreTarget = originalTarget?.isConnected
          ? originalTarget
          : fallbackTarget?.isConnected
            ? fallbackTarget
            : lowerModalTarget
        restoreTarget?.focus({ preventScroll: true })
      }, 0)
    }
  }, [active])

  const isTopModal = useMemo(() => () => modalStack[modalStack.length - 1]?.id === idRef.current, [])

  useEffect(() => {
    if (!active) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal()) return
      onGlobalKeyDown?.(event)
      if (event.defaultPrevented) {
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
      if (event.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusable = focusableElements(dialog)
        const firstFocusable = focusable[0]
        const lastFocusable = focusable[focusable.length - 1]
        const activeElement = document.activeElement
        if (!firstFocusable || !lastFocusable) {
          event.preventDefault()
          dialog.focus({ preventScroll: true })
          return
        }
        if (event.shiftKey && (activeElement === firstFocusable || !dialog.contains(activeElement))) {
          event.preventDefault()
          lastFocusable.focus({ preventScroll: true })
          return
        }
        if (!event.shiftKey && (activeElement === lastFocusable || !dialog.contains(activeElement))) {
          event.preventDefault()
          firstFocusable.focus({ preventScroll: true })
        }
        return
      }
      if (event.key !== 'Escape' || !closeOnEscape) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [active, closeOnEscape, isTopModal, onClose, onGlobalKeyDown])

  const blockBackdropPress = (event: MouseEvent | PointerEvent) => {
    if (event.target !== event.currentTarget) return
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target !== event.currentTarget) return
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    if (!closeOnBackdrop) return
    if (isTopModal()) onClose()
  }

  const backdropClasses = `${backdropClassName}${hidden ? ' modal-backdrop-hidden' : ''}`
  const style = { zIndex: MODAL_BASE_Z_INDEX + depth * 10 } satisfies CSSProperties

  return createPortal(
    <div
      ref={backdropRef}
      className={backdropClasses}
      aria-hidden={hidden || undefined}
      style={style}
      onClick={handleBackdropClick}
      onContextMenu={blockModalContextMenu}
      onContextMenuCapture={blockModalContextMenu}
      onMouseDown={blockBackdropPress}
      onMouseDownCapture={blockBackdropPress}
      onPointerDown={blockBackdropPress}
      onPointerDownCapture={blockBackdropPress}
    >
      <div
        ref={dialogRef}
        className={dialogClassName}
        role={hidden ? undefined : 'dialog'}
        aria-modal={hidden ? undefined : 'true'}
        aria-label={hidden ? undefined : label}
        tabIndex={hidden ? undefined : -1}
        onClick={stopModalEvent}
        onContextMenu={blockModalContextMenu}
        onMouseDown={stopModalEvent}
        onPointerDown={stopModalEvent}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
