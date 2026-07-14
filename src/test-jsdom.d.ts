declare module 'jsdom' {
  export type DOMWindow = Window & typeof globalThis & { close: () => void }

  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        beforeParse?: (window: DOMWindow) => void
        runScripts?: 'dangerously'
        url?: string
      },
    )

    readonly window: DOMWindow
  }
}
