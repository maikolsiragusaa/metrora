import { useEffect, useRef } from 'react'

import { codeburn } from '../lib/ipc'
import type { DateRange, Period } from '../lib/types'
import type { DetectedProvider } from './useDesktopScope'
import { hasPolledMemo, primePolledMemo, setPolledMemoMax } from './usePolled'

// Wait for the first paint before background warming begins.
const PREFETCH_START_DELAY_MS = 1500
// A warm spawn takes seconds, so pace providers widely enough that each warm
// genuinely trails the last and never becomes a parallel full-history fan-out.
const PREFETCH_STAGGER_MS = 2000
// Base instant-switch memo keys live beside the per-provider entries:
// overview|all, overview-act, overview-yield, plus navigation headroom.
const BASE_MEMO_KEYS = 4

/** Shared memo-key authority for the visible Overview poll and provider warming. */
export function overviewMemoKey(provider: string, period: Period, range: DateRange | null, configSource: string | null): string {
  return `overview|${provider}|${period}|${range?.from ?? ''}-${range?.to ?? ''}|${configSource ?? ''}`
}

/** Owns low-priority provider warming without owning discovery or visible polling. */
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
  detectedProviders: DetectedProvider[]
  period: Period
  provider: string
  customRange: DateRange | null
  scopedClaudeConfigSource: string | null
}): void {
  // Hold every warmed provider plus the visible/base entries so LRU eviction
  // cannot blank the active overview and re-arm a prefetch storm.
  useEffect(() => {
    setPolledMemoMax(detectedProviders.length + BASE_MEMO_KEYS)
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
    const targets = detectedProviders.map(entry => entry.id).filter(id => id !== provider)
    if (targets.length === 0) return

    let cancelled = false
    const warm = async () => {
      for (let i = 0; i < targets.length && !cancelled; ) {
        const key = overviewMemoKey(targets[i]!, period, null, null)
        if (warmedKeys.current.has(key) || hasPolledMemo(key)) {
          i++
          continue
        }

        if (overviewBusyRef.current) {
          await new Promise(resolve => setTimeout(resolve, PREFETCH_STAGGER_MS))
          continue
        }

        warmedKeys.current.add(key)
        try {
          const value = await codeburn.getOverview(period, targets[i]!, undefined, undefined, true)
          if (!cancelled) primePolledMemo(key, value)
        } catch {
          // Best-effort only: a real provider switch will fetch and surface errors.
        }

        i++
        if (!cancelled && i < targets.length) {
          await new Promise(resolve => setTimeout(resolve, PREFETCH_STAGGER_MS))
        }
      }
    }

    const start = setTimeout(() => { void warm() }, PREFETCH_START_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(start)
    }
  }, [ready, hasOverviewData, period, provider, customRange, scopedClaudeConfigSource, detectedProviders])
}
