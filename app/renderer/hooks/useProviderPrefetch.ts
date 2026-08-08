import { useEffect, useRef } from 'react'

import { metrora } from '../lib/ipc'
import type { DateRange, Period } from '../lib/types'
import { hasPolledMemo, primePolledMemo, setPolledMemoMax } from './usePolled'

// Wait for the first paint before background warming begins.
const PREFETCH_START_DELAY_MS = 1800
// A warm spawn can take seconds, so every background task is strictly serial and
// spaced out. A visible user fetch always pauses the loop.
const PREFETCH_STAGGER_MS = 1800
const COMMON_PERIODS: readonly Period[] = ['today', 'week', '30days', 'month', 'all', 'lifetime']
// Base instant-switch memo keys live beside warmed periods/providers:
// visible overview + non-overview section memos/navigation headroom.
const BASE_MEMO_KEYS = 5

type PrefetchProvider = {
  id: string
}

type WarmTarget = {
  provider: string
  period: Period
}

/** Shared memo-key authority for the visible Overview poll and background warming. */
export function overviewMemoKey(provider: string, period: Period, range: DateRange | null, configSource: string | null): string {
  return `overview|${provider}|${period}|${range?.from ?? ''}-${range?.to ?? ''}|${configSource ?? ''}`
}

/**
 * Owns low-priority Overview warming without owning discovery or visible polling.
 *
 * The old loop warmed only provider switches for the CURRENT period. That made a
 * first click on 7D / 30D / Lifetime blank even after startup had already paid the
 * expensive history hydration. RC10 warms common periods for the active provider
 * first, then provider alternatives for the active period. Tasks are serial,
 * low-priority, and pause whenever the visible Overview is busy.
 */
export function useProviderPrefetch({
  ready,
  hasOverviewData,
  overviewLoading,
  detectedProviders,
  period,
  provider,
  customRange,
  scopedClaudeConfigSource,
}: {
  ready: boolean
  hasOverviewData: boolean
  overviewLoading: boolean
  detectedProviders: PrefetchProvider[]
  period: Period
  provider: string
  customRange: DateRange | null
  scopedClaudeConfigSource: string | null
}): void {
  // Keep common periods + provider alternatives around long enough for instant
  // switches. setPolledMemoMax clamps to its global safety cap.
  useEffect(() => {
    setPolledMemoMax(detectedProviders.length + COMMON_PERIODS.length + BASE_MEMO_KEYS)
  }, [detectedProviders.length])

  // The visible user fetch always has priority. A ref keeps the warming loop
  // informed without re-arming the effect on every loading transition.
  const overviewBusyRef = useRef(false)
  overviewBusyRef.current = overviewLoading

  // Session-lifetime once-per-key guard. Mark before spawning so an effect
  // restart cannot duplicate a warm already in flight.
  const warmedKeys = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!ready || !hasOverviewData || customRange || scopedClaudeConfigSource) return

    const periodTargets: WarmTarget[] = COMMON_PERIODS
      .filter(candidate => candidate !== period)
      .map(candidate => ({ provider, period: candidate }))
    const providerTargets: WarmTarget[] = detectedProviders
      .map(entry => entry.id)
      .filter(id => id !== provider)
      .map(id => ({ provider: id, period }))
    const targets = [...periodTargets, ...providerTargets]
    if (targets.length === 0) return

    let cancelled = false
    const sleep = () => new Promise(resolve => setTimeout(resolve, PREFETCH_STAGGER_MS))

    const warm = async () => {
      for (let i = 0; i < targets.length && !cancelled; ) {
        const target = targets[i]!
        const key = overviewMemoKey(target.provider, target.period, null, null)
        if (warmedKeys.current.has(key) || hasPolledMemo(key)) {
          i++
          continue
        }

        if (overviewBusyRef.current) {
          await sleep()
          continue
        }

        warmedKeys.current.add(key)
        try {
          const value = await metrora.getOverview(target.period, target.provider, undefined, undefined, true)
          if (!cancelled) primePolledMemo(key, value)
        } catch {
          // Best-effort only: a real switch will fetch and surface the error.
        }

        i++
        if (!cancelled && i < targets.length) await sleep()
      }
    }

    const start = setTimeout(() => { void warm() }, PREFETCH_START_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(start)
    }
  }, [ready, hasOverviewData, period, provider, customRange, scopedClaudeConfigSource, detectedProviders])
}
