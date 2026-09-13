import { afterEach, describe, expect, it } from 'vitest'

import type { DailyCache } from './daily-cache.js'
import type { MenubarPayload } from './menubar-json.js'
import { consumeFreshReconcileOutcome, markFreshReconcileSkipped, withReadFreshness } from './read-lifecycle.js'

function fakeCache(complete: boolean): DailyCache {
  return { complete, lastComputedDate: '2026-09-13' } as unknown as DailyCache
}

function stamp(payload: MenubarPayload, cache: DailyCache, opts: { targeted?: boolean; outcome?: Parameters<typeof withReadFreshness>[3] } = {}) {
  return withReadFreshness(payload, cache, opts.targeted ?? false, opts.outcome)
}

afterEach(() => {
  // consume-and-reset so skipped outcomes from one test never bleed into the next.
  consumeFreshReconcileOutcome()
})

describe('withReadFreshness', () => {
  it('keeps the pre-existing semantics when no reconcile outcome is passed', () => {
    const complete = stamp({} as MenubarPayload, fakeCache(true))
    expect(complete.freshness).toEqual({ readMode: 'fresh', reconciliation: 'complete', durableThrough: '2026-09-13' })

    const degraded = stamp({} as MenubarPayload, fakeCache(false))
    expect(degraded.freshness?.reconciliation).toBe('degraded')

    const targeted = stamp({} as MenubarPayload, fakeCache(true), { targeted: true })
    expect(targeted.freshness?.reconciliation).toBe('targeted')
  })

  it('degrades a complete cache when the fresh reconcile silently served the prior snapshot', () => {
    const outcome = stamp({} as MenubarPayload, fakeCache(true), { outcome: 'skipped-lock-busy' })
    expect(outcome.freshness).toEqual({ readMode: 'fresh', reconciliation: 'degraded', durableThrough: '2026-09-13' })
  })

  it('degrades targeted reads too: a scoped read that served stale is not fresh', () => {
    const outcome = stamp({} as MenubarPayload, fakeCache(true), { targeted: true, outcome: 'skipped-fence-lost' })
    expect(outcome.freshness?.reconciliation).toBe('degraded')
  })
})

describe('fresh reconcile outcome tracking', () => {
  it('starts reconciled and resets after a consume', () => {
    expect(consumeFreshReconcileOutcome()).toBe('reconciled')
    markFreshReconcileSkipped('skipped-lock-busy')
    expect(consumeFreshReconcileOutcome()).toBe('skipped-lock-busy')
    expect(consumeFreshReconcileOutcome()).toBe('reconciled')
  })

  it('keeps the worst outcome across multiple parse calls of one payload build', () => {
    markFreshReconcileSkipped('skipped-lock-busy')
    markFreshReconcileSkipped('skipped-fence-lost')
    expect(consumeFreshReconcileOutcome()).toBe('skipped-lock-busy')
  })
})
