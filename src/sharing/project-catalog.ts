import { aggregateProjectsIntoDays } from '../day-aggregator.js'
import { loadDailyCache, emptyCache, type DailyCache, type DailyEntry } from '../daily-cache.js'
import { parseAllSessions } from '../parser.js'
import { readProjectRegistry, type ProjectRegistryReadResult } from '../project-registry.js'
import { ALL_PROJECTS_SCOPE_ID, buildProjectScopePayload } from '../project-scope.js'
import type { DateRange, ProjectSummary } from '../types.js'

export const COMPANION_PROJECTS_KIND = 'metrora.companion.projects' as const
export const COMPANION_PROJECTS_VERSION = 1 as const

function todayRange(now: Date): DateRange {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end: now,
  }
}

export type ProjectCatalogProjectionDeps = {
  now?: () => Date
  readRegistry?: () => Promise<ProjectRegistryReadResult>
  loadCache?: () => Promise<DailyCache>
  parseTodaySessions?: (range: DateRange) => Promise<ProjectSummary[]>
}

function unavailableScope() {
  return {
    selectedId: ALL_PROJECTS_SCOPE_ID,
    options: [],
    sourceProjects: [],
    registry: { status: 'missing' as const, writable: false },
  }
}

/**
 * Read the non-period Project authority without depending on Activity,
 * Analyze, or a selected period succeeding. Durable days provide historical
 * Source Project identities; today's scan adds currently active identities.
 */
export async function buildCompanionProjectCatalogProjection(
  deps: ProjectCatalogProjectionDeps = {},
): Promise<unknown> {
  const now = deps.now?.() ?? new Date()
  const registryResult = await (deps.readRegistry ?? readProjectRegistry)()
  let cache = emptyCache()
  try {
    cache = await (deps.loadCache ?? loadDailyCache)()
  } catch {
    // An unavailable cache is represented as unavailable below, never as zero.
  }

  let todayEntries: DailyEntry[] = []
  let todayReadSucceeded = true
  try {
    const parseToday = deps.parseTodaySessions ?? ((range: DateRange) => parseAllSessions(range, 'all'))
    todayEntries = aggregateProjectsIntoDays(await parseToday(todayRange(now)))
  } catch {
    todayReadSucceeded = false
  }

  const scope = buildProjectScopePayload(
    registryResult.registry,
    registryResult.status,
    [],
    ALL_PROJECTS_SCOPE_ID,
    [...cache.days, ...todayEntries],
  )
  const hasObservedSourceProjects = scope.sourceProjects.length > 0
  const available = registryResult.status !== 'corrupt' &&
    (hasObservedSourceProjects || (todayReadSucceeded && registryResult.registry.projects.length === 0))
  return {
    kind: COMPANION_PROJECTS_KIND,
    version: COMPANION_PROJECTS_VERSION,
    generatedAt: now.toISOString(),
    freshness: todayReadSucceeded ? 'live' : 'cached',
    available,
    projectScope: available ? scope : unavailableScope(),
  }
}
