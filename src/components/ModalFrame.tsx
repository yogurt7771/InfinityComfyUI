import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const MODAL_BASE_Z_INDEX = 1000
let modalStack: string[] = []

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
}: ModalFrameProps) {
  const reactId = useId()
  const idRef = useRef(`modal-${reactId}`)
  const [depth, setDepth] = useState(0)
  const active = !hidden

  useEffect(() => {
    if (!active) return undefined

    const id = idRef.current
    modalStack = modalStack.filter((item) => item !== id)
    modalStack.push(id)
    setDepth(modalStack.length - 1)

    return () => {
      modalStack = modalStack.filter((item) => item !== id)
    }
  }, [active])

  const isTopModal = useMemo(() => () => modalStack[modalStack.length - 1] === idRef.current, [])

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
        className={dialogClassName}
        role={hidden ? undefined : 'dialog'}
        aria-modal={hidden ? undefined : 'true'}
        aria-label={hidden ? undefined : label}
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
