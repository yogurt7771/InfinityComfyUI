import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { ComfyWebviewElement } from './domain/comfyFrameBridge'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<ComfyWebviewElement>, ComfyWebviewElement> & {
        partition?: string
        src?: string
        title?: string
        webpreferences?: string
      }
    }
  }
}
