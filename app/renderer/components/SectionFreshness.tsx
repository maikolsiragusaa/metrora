import { useEffect, useState } from 'react'

import type { Polled } from '../hooks/usePolled'

/**
 * Per-section truth about the data on screen. The global footer tracks the
 * canonical overview fetch, but every section spawns its own CLI read that can
 * land later (CLI slot queue) or fail independently (last-good retention), so
 * this badge reports the section's own poll state instead of the overview's.
 */
export function SectionFreshness<T>({ report }: { report: Polled<T> }) {
  // Re-render once a second so the age label stays truthful between polls; the
  // interval lives inside this leaf component so sections themselves don't tick.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(tick => tick + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (report.error) return <span className="section-freshness section-freshness--stale">showing last good data</span>
  if (report.loading || report.switching) return <span className="section-freshness">updating…</span>
  if (report.lastSuccessAt === null) return null
  const seconds = Math.max(0, Math.floor((Date.now() - report.lastSuccessAt) / 1000))
  const label = seconds < 1 ? 'updated just now' : seconds < 60 ? `updated ${seconds}s ago` : `updated ${Math.floor(seconds / 60)}m ago`
  return <span className="section-freshness">{label}</span>
}
