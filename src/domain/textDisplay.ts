import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { TextDisplayMode } from './types'

export const textDisplayModes = [
  'plaintext',
  'markdown',
  'html',
  'json',
  'yaml',
  'render markdown',
  'render html',
] as const satisfies readonly TextDisplayMode[]

const textDisplayModeSet = new Set<string>(textDisplayModes)

export const normalizeTextDisplayMode = (value: unknown): TextDisplayMode =>
  typeof value === 'string' && textDisplayModeSet.has(value) ? (value as TextDisplayMode) : 'plaintext'

const sanitizeRenderedHtml = (value: string) =>
  String(
    DOMPurify.sanitize(value, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'audio',
        'base',
        'button',
        'embed',
        'form',
        'iframe',
        'img',
        'input',
        'link',
        'math',
        'meta',
        'object',
        'option',
        'picture',
        'script',
        'select',
        'source',
        'style',
        'svg',
        'template',
        'textarea',
        'track',
        'video',
      ],
      FORBID_ATTR: [
        'autofocus',
        'background',
        'class',
        'draggable',
        'form',
        'formaction',
        'id',
        'ping',
        'srcdoc',
        'style',
        'tabindex',
        'xlink:href',
      ],
    }),
  )

export const renderedTextHtml = (value: string, mode: TextDisplayMode) => {
  const source = String(value ?? '')
  if (mode === 'render markdown') {
    const html = marked.parse(source, { async: false, breaks: true, gfm: true })
    return sanitizeRenderedHtml(String(html))
  }
  if (mode === 'render html') return sanitizeRenderedHtml(source)
  return ''
}
