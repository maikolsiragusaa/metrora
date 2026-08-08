import { useCallback, useEffect, useRef, useState } from 'react'

import { metrora } from '../lib/ipc'
import { localDateKey } from '../lib/period'
import type { DateRange, MenubarPayload, ModelReportRow, Period, TelemetryStatus } from '../lib/types'

function costBucket(usd: number): string {
  if (usd < 1) return '<1'
  if (usd < 10) return '1-10'
  if (usd < 50) return '10-50'
  if (usd < 200) return '50-200'
  if (usd < 1000) return '200-1k'
  return '1k+'
}

function countBucket(n: number): string {
  if (n < 10) return '1-10'
  if (n < 100) return '10-100'
  if (n < 1000) return '100-1k'
  return '1k+'
}

/** Map models to their dominant task category without inventing missing joins. */
export function topCategoryByModel(rows: ModelReportRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    if (!row.topCategory) continue
    if (!map.has(row.modelDisplayName)) map.set(row.modelDisplayName, row.topCategory)
    if (!map.has(row.model)) map.set(row.model, row.topCategory)
  }
  return map
}

/** Build the bounded once-per-day anonymous aggregate consumed by main-process telemetry. */
export function usageSnapshotProps(
  payload: MenubarPayload,
  modelCategories?: Map<string, string>,
): Record<string, unknown> {
  return {
    period: payload.current.label,
    providerCount: Object.keys(payload.current.providers).length,
    costBucket: costBucket(payload.current.cost),
    models: (payload.current.topModels ?? []).slice(0, 8).map(model => {
      const entry: Record<string, unknown> = { name: model.name, costBucket: costBucket(model.cost) }
      const topCategory = modelCategories?.get(model.name)
      if (topCategory) entry.topCategory = topCategory
      return entry
    }),
    providers: Object.entries(payload.current.providers ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, cost]) => ({ name, costBucket: costBucket(cost) })),
    categories: (payload.current.topActivities ?? []).slice(0, 12).map(activity => ({
      name: activity.name,
      oneShotRate: activity.oneShotRate == null ? -1 : Math.round(activity.oneShotRate * 100) / 100,
    })),
    mcpServers: (payload.current.mcpServers ?? []).slice(0, 12).map(server => ({
      name: server.name,
      callBucket: countBucket(server.calls),
    })),
    skills: (payload.current.skills ?? []).slice(0, 12).map(skill => ({
      name: skill.name,
      callBucket: countBucket(skill.turns),
    })),
  }
}

type DesktopTelemetryOptions = {
  overviewData: MenubarPayload | null
  period: Period
  provider: string
  customRange: DateRange | null
  scopedClaudeConfigSource: string | null
}

export type DesktopTelemetry = {
  onboardingStatus: TelemetryStatus | null
  finishOnboarding: (enabled: boolean) => void
  trackEvent: (name: string, props?: Record<string, unknown>) => void
}

/**
 * Owns optional consent, best-effort shell events, and the bounded canonical
 * daily snapshot without becoming an analytics or navigation authority.
 */
export function useDesktopTelemetry({
  overviewData,
  period,
  provider,
  customRange,
  scopedClaudeConfigSource,
}: DesktopTelemetryOptions): DesktopTelemetry {
  const [onboardingStatus, setOnboardingStatus] = useState<TelemetryStatus | null>(null)

  useEffect(() => {
    if (typeof metrora.telemetryStatus !== 'function') return
    metrora.telemetryStatus()
      .then(status => { if (status && !status.onboarded) setOnboardingStatus(status) })
      .catch(() => { /* Optional telemetry unavailable: skip consent UI and tracking. */ })
  }, [])

  const finishOnboarding = useCallback((enabled: boolean) => {
    setOnboardingStatus(null)
    if (typeof metrora.completeOnboarding === 'function') {
      void metrora.completeOnboarding(enabled).catch(() => {})
    }
  }, [])

  const trackEvent = useCallback((name: string, props?: Record<string, unknown>) => {
    if (typeof metrora.telemetryTrack === 'function') {
      void metrora.telemetryTrack(name, props).catch(() => {})
    }
  }, [])

  // Main process also deduplicates by calendar day. This renderer guard avoids
  // the enrichment fetch on every poll and keeps the aggregate canonical: all
  // providers, a standard period, and no Claude-config scope.
  const snapshotDayRef = useRef<string | null>(null)
  useEffect(() => {
    if (!overviewData || provider !== 'all' || customRange || scopedClaudeConfigSource) return
    const today = localDateKey(new Date())
    if (snapshotDayRef.current === today) return
    snapshotDayRef.current = today
    const payload = overviewData
    void (async () => {
      let modelCategories: Map<string, string> | undefined
      try {
        modelCategories = topCategoryByModel(await metrora.getModels(period, 'all', false))
      } catch {
        // The aggregate remains valid without the optional model/category join.
      }
      trackEvent('usage_snapshot', usageSnapshotProps(payload, modelCategories))
    })()
  }, [overviewData, provider, customRange, scopedClaudeConfigSource, period, trackEvent])

  return { onboardingStatus, finishOnboarding, trackEvent }
}
