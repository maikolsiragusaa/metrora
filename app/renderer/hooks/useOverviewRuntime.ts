import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import { setActiveCurrency } from '../lib/format'
import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period } from '../lib/types'
import { providerName } from './useDesktopScope'
import { overviewMemoKey, useProviderPrefetch } from './useProviderPrefetch'
import { clearPolledMemo, type Polled, usePolled } from './usePolled'

export type DetectedProvider = {
  id: string
  label: string
}

export type ConfigMutationKind = 'accounting' | 'display'

type OverviewRuntimeOptions = {
  period: Period
  provider: string
  customRange: DateRange | null
  scopedClaudeConfigSource: string | null
  detectedProviders: DetectedProvider[]
  setDetectedProviders: Dispatch<SetStateAction<DetectedProvider[]>>
}

export type OverviewRuntime = {
  overview: Polled<MenubarPayload>
  ready: boolean
  refreshToken: number
  refreshVisible: () => void
  onConfigMutated: (kind?: ConfigMutationKind) => void
}

/** Derive stable provider picker entries from the canonical Overview payload. */
export function detectedProvidersFromOverview(payload: MenubarPayload): DetectedProvider[] {
  const details = payload.current.providerDetails
  if (details) {
    return [...details]
      .sort((a, b) => b.cost - a.cost)
      .map(entry => ({ id: entry.id, label: entry.label }))
  }

  return Object.entries(payload.current.providers)
    // Legacy map keys are lowercased display names. Keys containing spaces cannot
    // round-trip through --provider, so do not expose a guaranteed-invalid filter.
    .filter(([key]) => /^[a-z0-9-]+$/.test(key))
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => ({ id: key, label: providerName(key) }))
}

/**
 * Owns the canonical desktop Overview poll and the runtime responsibilities that
 * depend directly on its accepted payload. App.tsx retains only composition and
 * the detected-provider state needed to break the scope/runtime dependency loop.
 */
export function useOverviewRuntime({
  period,
  provider,
  customRange,
  scopedClaudeConfigSource,
  detectedProviders,
  setDetectedProviders,
}: OverviewRuntimeOptions): OverviewRuntime {
  const [refreshToken, setRefreshToken] = useState(0)
  // Currency formatting is module-scoped. The local state tick ensures the
  // owning shell repaints immediately after an accepted fresh payload changes it.
  const [, setCurrencyTick] = useState(0)

  // Preserve the existing 2/3-argument bridge calls when no config is scoped;
  // only add --claude-config-source once the user selected a real config.
  const overview = usePolled<MenubarPayload>(
    () => scopedClaudeConfigSource
      ? metrora.getOverview(period, provider, customRange ?? undefined, scopedClaudeConfigSource)
      : customRange
      ? metrora.getOverview(period, provider, customRange)
      : metrora.getOverview(period, provider),
    [period, provider, customRange?.from, customRange?.to, scopedClaudeConfigSource],
    { memoKey: overviewMemoKey(provider, period, customRange, scopedClaudeConfigSource) },
  )

  // The first Overview resolution is the single cold-cache warm authority. This
  // latch must never close again when a later uncached scope paints a skeleton.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (overview.data != null || overview.error != null) setReady(true)
  }, [overview.data, overview.error])

  useEffect(() => {
    if (!overview.data) return
    const found = detectedProvidersFromOverview(overview.data)
    setDetectedProviders(current => {
      const next = [...current]
      for (const item of found) {
        if (!next.some(entry => entry.id === item.id)) next.push(item)
      }
      return next.length === current.length ? current : next
    })
  }, [overview.data, setDetectedProviders])

  useEffect(() => {
    const currency = overview.data?.currency
    if (!currency || overview.switching) return
    // A memo-served payload can carry the currency that preceded a Settings
    // mutation. Only a freshly resolved payload may update global formatting.
    setActiveCurrency(currency)
    setCurrencyTick(tick => tick + 1)
  }, [
    overview.data?.currency?.code,
    overview.data?.currency?.rate,
    overview.data?.currency?.symbol,
    overview.switching,
  ])

  useProviderPrefetch({
    ready,
    hasOverviewData: overview.data != null,
    overviewLoading: overview.loading,
    detectedProviders,
    period,
    provider,
    customRange,
    scopedClaudeConfigSource,
  })

  const refreshVisible = useCallback(() => {
    overview.refresh()
    setRefreshToken(token => token + 1)
  }, [overview.refresh])

  const onConfigMutated = useCallback((kind: ConfigMutationKind = 'accounting') => {
    if (kind === 'display') {
      // Currency is a presentation transform over raw USD values. Preserve every
      // warmed section/period memo and refresh only the canonical Overview so its
      // currency descriptor updates the global formatter. Previously this wiped
      // all memoized views and made the app look as if it were rescanning usage.
      overview.refresh()
      return
    }

    // Alias/pricing/plan changes can alter computed accounting. Those genuinely
    // invalidate warmed payloads and section reports.
    clearPolledMemo()
    refreshVisible()
  }, [overview.refresh, refreshVisible])

  return { overview, ready, refreshToken, refreshVisible, onConfigMutated }
}
