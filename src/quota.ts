/**
 * Provider-window pace interpretation for the CLI/library boundary.
 *
 * The Electron live path's canonical JSON contract lives in
 * app/electron/quota/types.ts because that module is shared directly with the
 * renderer bridge. This file intentionally contains no live-quota authority,
 * no local-history capacity estimate, and no live/derived merge behavior.
 */

export type QuotaPace = {
  /** Elapsed fraction of the window, 0..1. */
  expectedFraction: number
  /** usedFraction − expectedFraction; positive = ahead of pace (deficit). */
  deltaFraction: number
  /** Linear projection of usedFraction at the reset boundary. */
  projectedAtReset: number
  /** Conservative exhaustion ETA for sufficiently long windows only. */
  exhaustsAt?: Date
}

/** Input accepted by computePace. Date is retained for pure math callers. */
export type QuotaPaceWindow = {
  usedFraction: number
  resetsAt?: string | Date | null
  windowSeconds?: number | null
}

/** No pace until this fraction of the window has elapsed. */
export const QUOTA_PACE_MIN_ELAPSED_FRACTION = 0.03

/** Windows at or under this length report deficit but no exhaustion ETA. */
export const QUOTA_PACE_ETA_MAX_WINDOW_SECONDS = 6 * 3600

function validDate(value: string | Date | null | undefined): Date | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : undefined
  if (typeof value !== 'string' || !value) return undefined
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : undefined
}

/**
 * Whole-window linear pace with guards that keep it honest. Returns undefined
 * when the provider window lacks inputs, has not elapsed enough to say
 * anything, is exhausted, or has a skewed reset boundary.
 */
export function computePace(window: QuotaPaceWindow, now: Date = new Date()): QuotaPace | undefined {
  const resetsAt = validDate(window.resetsAt)
  const windowSeconds = window.windowSeconds
  const nowMs = now.getTime()
  if (!resetsAt || !Number.isFinite(nowMs) || typeof windowSeconds !== 'number' || !Number.isFinite(windowSeconds) || windowSeconds <= 0) return undefined

  const remainingSeconds = (resetsAt.getTime() - nowMs) / 1000
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0 || remainingSeconds > windowSeconds) return undefined

  const elapsedSeconds = windowSeconds - remainingSeconds
  const expectedFraction = elapsedSeconds / windowSeconds
  if (!Number.isFinite(expectedFraction) || expectedFraction < QUOTA_PACE_MIN_ELAPSED_FRACTION) return undefined
  if (!Number.isFinite(window.usedFraction)) return undefined

  const used = Math.min(Math.max(window.usedFraction, 0), 1)
  if (!Number.isFinite(used) || used >= 1) return undefined

  const projectedAtReset = used / expectedFraction
  if (!Number.isFinite(projectedAtReset)) return undefined
  const pace: QuotaPace = {
    expectedFraction,
    deltaFraction: used - expectedFraction,
    projectedAtReset,
  }

  if (projectedAtReset > 1 && windowSeconds > QUOTA_PACE_ETA_MAX_WINDOW_SECONDS) {
    const usedPerSecond = used / elapsedSeconds
    if (Number.isFinite(usedPerSecond) && usedPerSecond > 0) {
      const eta = nowMs + ((1 - used) / usedPerSecond) * 1000
      if (Number.isFinite(eta) && eta < resetsAt.getTime()) pace.exhaustsAt = new Date(eta)
    }
  }
  return pace
}
