export function shouldIgnoreCanvasShortcut(event: Pick<KeyboardEvent, 'isComposing'> & { target: EventTarget | null }) {
  if (event.isComposing) return true
  const target = event.target
  if (!(target instanceof Element)) return false

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest('[contenteditable="true"]') !== null
  )
}
