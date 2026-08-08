import type { DailyCache } from './daily-cache.js'
import type { MenubarPayload } from './menubar-json.js'

/** True only for non-mutating desktop read-through processes. */
export function isSnapshotReadMode(): boolean {
  return process.env['METRORA_READ_MODE'] === 'snapshot'
}

export function withReadFreshness(payload: MenubarPayload, cache: DailyCache, targeted: boolean): MenubarPayload {
  payload.freshness = { readMode: isSnapshotReadMode() ? 'snapshot' : 'fresh', reconciliation: targeted ? 'targeted' : cache.complete === true ? 'complete' : 'degraded', durableThrough: cache.lastComputedDate }
  return payload
}
