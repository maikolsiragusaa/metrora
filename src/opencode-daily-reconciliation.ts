import type { DateRange, ProjectSummary } from './types.js'
import { aggregateProjectsIntoDays } from './day-aggregator.js'
import { clearSessionCache, filterProjectsByDateRange, parseAllSessions } from './parser.js'
import { latestParserDiscoveryProviderComplete } from './parser-discovery-state.js'
import {
  clearOpenCodeDailyInvalidations,
  readOpenCodeDailyInvalidatedDays,
} from './opencode-daily-invalidation.js'
import {
  DURABLE_HISTORY_AUTHORITY,
  ensureCacheHydrated,
  loadDailyCache,
  type DailyCache,
} from './daily-cache.js'
import { getDailyCacheConfigHash } from './daily-cache-config.js'

/**
 * A provider-scoped parse that returns no calls is not safe to publish over an
 * existing OpenCode history. This can happen when a fresh process receives an
 * incomplete accounting environment (or while the source is being moved),
 * even though discovery itself reports success. Keep this check deliberately
 * based on materialized evidence rather than only `providers.opencode`: an
 * empty provider slice is not history that needs protecting.
 */
export function hasOpenCodeDailyEvidence(cache: Pick<DailyCache, 'days'>): boolean {
  return cache.days.some(day => {
    const slice = day.providers.opencode
    if (!slice) return false
    return slice.calls > 0
      || (slice.sessions ?? 0) > 0
      || (slice.inputTokens ?? 0) > 0
      || (slice.outputTokens ?? 0) > 0
      || (slice.reasoningTokens ?? 0) > 0
      || (slice.cacheReadTokens ?? 0) > 0
      || (slice.cacheWriteTokens ?? 0) > 0
      || Object.keys(slice.models ?? {}).length > 0
      || Object.keys(slice.categories ?? {}).length > 0
      || Object.keys(slice.projects ?? {}).length > 0
  })
}

export function hasOpenCodeParsedCalls(projects: readonly ProjectSummary[]): boolean {
  return projects.some(project => project.sessions.some(session =>
    session.turns.some(turn => turn.assistantCalls.length > 0),
  ))
}

/**
 * Rebuild only the OpenCode slices whose source records changed. The source
 * parse is deliberately provider-scoped; unrelated providers remain carried
 * baseline authority inside ensureCacheHydrated().
 */
export async function reconcilePendingOpenCodeDailyHistory(existingCache?: DailyCache): Promise<DailyCache> {
  const baseline = existingCache ?? await loadDailyCache()
  const days = await readOpenCodeDailyInvalidatedDays()
  if (days.length === 0) return baseline

  // The desktop process can keep a provider-scoped parse result alive between
  // refreshes. A pending source marker is evidence that such a result may be
  // stale, so force this reconciliation to read the current source set.
  clearSessionCache()
  const projects = await parseAllSessions(undefined, 'opencode')
  const providerComplete = latestParserDiscoveryProviderComplete('opencode') === true
  // Discovery can be technically complete while yielding no sources (for
  // example after an environment override is lost). Never let that empty
  // result replace a non-empty durable OpenCode slice; leave the marker in
  // place so the next refresh retries after the source/environment recovers.
  if (!providerComplete || (!hasOpenCodeParsedCalls(projects) && hasOpenCodeDailyEvidence(baseline))) {
    return baseline
  }
  const cache = await ensureCacheHydrated(
    async (range: DateRange): Promise<ProjectSummary[]> => filterProjectsByDateRange(projects, range),
    aggregateProjectsIntoDays,
    getDailyCacheConfigHash(),
    () => providerComplete,
    undefined,
    {
      durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY,
      reconcileProviderDays: { opencode: days },
    },
  )

  if (providerComplete && cache.complete === true) await clearOpenCodeDailyInvalidations()
  return cache
}
