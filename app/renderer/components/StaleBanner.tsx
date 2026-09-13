import type { CliError } from '../lib/types'

/**
 * One-line notice shown when a section still has last-good data but the latest
 * background poll failed. Muted so it never competes with the data below it.
 */
export function StaleBanner({ error }: { error: CliError }) {
  return (
    <div role="status" className="stale-banner">
      Refresh failed, showing last good data · {error.message}
    </div>
  )
}

/** Notice used when the canonical payload is usable but source reconciliation
 * did not complete, so durable values may still be last-good. */
export function IncompleteReconciliationBanner() {
  return (
    <div role="status" className="stale-banner">
      Showing canonical last-good data · source reconciliation is incomplete
    </div>
  )
}
