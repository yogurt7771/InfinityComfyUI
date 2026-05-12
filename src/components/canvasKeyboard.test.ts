import { describe, expect, it } from 'vitest'
import { shouldIgnoreCanvasShortcut } from './canvasKeyboard'

describe('canvas keyboard shortcuts', () => {
  it('ignores composing keyboard events and editable targets', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const contentEditable = document.createElement('div')
    contentEditable.setAttribute('contenteditable', 'true')

    expect(shouldIgnoreCanvasShortcut({ target: input, isComposing: false })).toBe(true)
    expect(shouldIgnoreCanvasShortcut({ target: textarea, isComposing: false })).toBe(true)
    expect(shouldIgnoreCanvasShortcut({ target: select, isComposing: false })).toBe(true)
    expect(shouldIgnoreCanvasShortcut({ target: contentEditable, isComposing: false })).toBe(true)
    expect(shouldIgnoreCanvasShortcut({ target: document.createElement('div'), isComposing: true })).toBe(true)
    expect(shouldIgnoreCanvasShortcut({ target: document.createElement('div'), isComposing: false })).toBe(false)
  })
})
