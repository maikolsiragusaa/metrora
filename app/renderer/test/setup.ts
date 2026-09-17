import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// Only wire DOM cleanup in a browser-like (jsdom) environment; node-env tests
// (cli/main) have no document and must not import RTL's DOM cleanup — nor the
// renderer hook graph (usePolled → ipc touches `window` at load).
if (typeof document !== 'undefined') {
  // Renderer integration tests historically exercise the macOS presentation
  // contract. Keep that environment deterministic; platform-specific shortcut
  // behavior is covered separately with explicit macOS and Windows inputs.
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'MacIntel',
  })

  const { cleanup } = await import('@testing-library/react')
  // The usePolled memo is module-level and persists across renders; clear it
  // between tests so a cached result from one test never seeds another. The
  // durable restart snapshots live in the same jsdom localStorage across the
  // whole file, so they are cleared too: otherwise a payload one test
  // persisted would paint as another test's instant snapshot after the reset.
  // The report generation counter is likewise reset: generation enforcement
  // (stale memos never serve past a publish) must start deterministic.
  const { __resetPolledMemo } = await import('../hooks/usePolled')
  const { __resetReportGeneration } = await import('../lib/reportGeneration')
  afterEach(() => {
    cleanup()
    __resetPolledMemo()
    __resetReportGeneration()
    try {
      globalThis.localStorage?.clear()
    } catch {
      /* storage can be unavailable */
    }
  })
}
