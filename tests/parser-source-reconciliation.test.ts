import { describe, expect, it } from 'vitest'
import { reconcileMissingProviderSources, shouldReconcileMissingProviderSources } from '../src/parser-source-reconciliation.js'
import type { SessionCache } from '../src/session-cache.js'

function cacheWithRetainedSource(): SessionCache {
  return {
    version: 8,
    complete: true,
    providers: {
      alpha: {
        envFingerprint: 'env',
        files: { '/retained.jsonl': { turns: [] } as never },
      },
    },
  } as unknown as SessionCache
}

describe('provider discovery reconciliation gate', () => {
  it('requires an explicit complete outcome for new callers', () => {
    expect(shouldReconcileMissingProviderSources('alpha', 0, false)).toBe(false)
    expect(shouldReconcileMissingProviderSources('alpha', 1, false)).toBe(false)
    expect(shouldReconcileMissingProviderSources('alpha', 0, true)).toBe(true)
    expect(shouldReconcileMissingProviderSources('alpha', 1, true)).toBe(true)
    expect(shouldReconcileMissingProviderSources('alpha', 1)).toBe(true)
  })

  it('retains source history on failed or partial discovery and deletes only after factual empty', () => {
    const failed = cacheWithRetainedSource()
    const failedSection = failed.providers.alpha!
    if (shouldReconcileMissingProviderSources('alpha', 0, false)) {
      reconcileMissingProviderSources('alpha', failedSection, new Set(), failed)
    }
    expect(failed.providers.alpha!.files['/retained.jsonl']).toBeDefined()

    const partial = cacheWithRetainedSource()
    const partialSection = partial.providers.alpha!
    if (shouldReconcileMissingProviderSources('alpha', 1, false)) {
      reconcileMissingProviderSources('alpha', partialSection, new Set(['/new.jsonl']), partial)
    }
    expect(partial.providers.alpha!.files['/retained.jsonl']).toBeDefined()

    const empty = cacheWithRetainedSource()
    const emptySection = empty.providers.alpha!
    if (shouldReconcileMissingProviderSources('alpha', 0, true)) {
      reconcileMissingProviderSources('alpha', emptySection, new Set(), empty)
    }
    expect(empty.providers.alpha!.files['/retained.jsonl']).toBeUndefined()
  })
})
