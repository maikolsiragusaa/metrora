/**
 * Canonical report generation contract.
 *
 * One successful explicit reconciliation publishes a canonical generation:
 * a monotonic counter plus the wall-clock moment this renderer published it.
 * Active sections re-read from that generation via the existing refreshToken
 * fan-in (their snapshot reads hit the freshly published canonical cache, so
 * no per-section full scan is needed). Inactive sections, when opened later,
 * mount with the latest refreshToken and read the same or a newer generation
 * from the same cache. Scope (period/provider/project) remains part of every
 * memo key, so a generation never mixes scopes.
 *
 * The counter is renderer-local by design: the CLI has no resident process to
 * own a cross-spawn generation, while the renderer is the single authority
 * that accepts explicit-refresh results. It is intentionally not persisted:
 * a restored snapshot must never claim it was refreshed in the current
 * process (the footer clock reads only fetches this run made).
 */

let generation = 0
let publishedAt: number | null = null

export type ReportGeneration = { n: number; at: number | null }

export function currentReportGeneration(): ReportGeneration {
  return { n: generation, at: publishedAt }
}

/** Publish a canonical generation after a successful explicit reconciliation. */
export function publishReportGeneration(at: number = Date.now()): ReportGeneration {
  generation += 1
  publishedAt = at
  return { n: generation, at: publishedAt }
}

/** Test-only reset. */
export function __resetReportGeneration(): void {
  generation = 0
  publishedAt = null
}
