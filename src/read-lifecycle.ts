import type { DailyCache } from './daily-cache.js'
import type { MenubarPayload } from './menubar-json.js'

/** True only for non-mutating desktop read-through processes. */
export function isSnapshotReadMode(): boolean {
  return process.env['METRORA_READ_MODE'] === 'snapshot'
}

/**
 * Outcome of the fresh-mode reconciliation attempts accumulated (worst-of)
 * across every parse one payload build performs. When the refresh lock is
 * contended or the publication fence is lost, the parse silently serves the
 * prior snapshot read-only and exits 0 — indistinguishable from a real
 * reconcile unless recorded here.
 */
export type FreshReconcileOutcome = 'reconciled' | 'skipped-lock-busy' | 'skipped-fence-lost'

let freshReconcileOutcome: FreshReconcileOutcome = 'reconciled'

/** Record that a fresh reconcile was downgraded to serving the prior snapshot. */
export function markFreshReconcileSkipped(outcome: Exclude<FreshReconcileOutcome, 'reconciled'>): void {
  if (freshReconcileOutcome === 'reconciled') freshReconcileOutcome = outcome
}

/** Read-and-reset: a payload build consumes the accumulated worst outcome once,
 * after all of its parses have completed. */
export function consumeFreshReconcileOutcome(): FreshReconcileOutcome {
  const outcome = freshReconcileOutcome
  freshReconcileOutcome = 'reconciled'
  return outcome
}

export function withReadFreshness(payload: MenubarPayload, cache: DailyCache, targeted: boolean, freshReconcile: FreshReconcileOutcome = 'reconciled'): MenubarPayload {
  const reconciliation = targeted ? 'targeted' : cache.complete === true ? 'complete' : 'degraded'
  payload.freshness = {
    readMode: isSnapshotReadMode() ? 'snapshot' : 'fresh',
    reconciliation: freshReconcile === 'reconciled' ? reconciliation : 'degraded',
    durableThrough: cache.lastComputedDate,
  }
  return payload
}
