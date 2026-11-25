import '@testing-library/jest-dom/vitest'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock

// React Flow re-measures handles (updateNodeInternals) through DOMMatrixReadOnly to read the zoom; jsdom has none.
class DOMMatrixReadOnlyMock {
  m22: number
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1]
    this.m22 = scale === undefined ? 1 : Number(scale)
  }
}

if (!('DOMMatrixReadOnly' in globalThis)) {
  ;(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyMock
}

// Tests never talk to a real server (a ComfyUI may be listening on the default 127.0.0.1:8188): unmocked http(s)
// requests fail as if offline. data:/blob: URLs still work; tests that need a server spy on fetch.
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (/^https?:/i.test(url)) return Promise.reject(new TypeError(`Network is disabled in tests: ${url}`))
  return realFetch(input, init)
}) as typeof fetch
