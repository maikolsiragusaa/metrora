import { emptyModelStats, mergeModelStats } from './daily-cache-model-detail.js'
import { cloneProjectStats, cloneProjectStatsMap, hasProjectUsage, mergeProjectDetails } from './daily-cache-project-detail.js'
import type { DailyEntry, ProjectDayStats, ProviderDaySlice } from './daily-cache-types.js'

const PROJECT_TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'reasoningTokens', 'additiveReasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function hasSliceData(slice: ProviderDaySlice): boolean {
  return slice.cost > 0 || slice.calls > 0 || (slice.savingsUSD ?? 0) > 0
    || (slice.inputTokens ?? 0) > 0 || (slice.outputTokens ?? 0) > 0
    || (slice.reasoningTokens ?? 0) > 0 || (slice.cacheReadTokens ?? 0) > 0
    || (slice.additiveReasoningTokens ?? 0) > 0
    || (slice.cacheWriteTokens ?? 0) > 0
}

function addProjectTokenEvidence(target: ProjectDayStats, source: ProjectDayStats, targetHadUsage: boolean): void {
  for (const field of PROJECT_TOKEN_FIELDS) {
    const sourceValue = source[field]
    if (!targetHadUsage) {
      if (sourceValue !== undefined) target[field] = sourceValue
      else delete target[field]
    } else if (sourceValue === undefined || target[field] === undefined) {
      // A project row aggregates contributions from multiple providers. One
      // legacy contribution without a field makes that field unknown for the
      // aggregate; never let a known subset masquerade as complete evidence.
      delete target[field]
    } else {
      target[field] += sourceValue
    }
  }
}

/** A legacy day whose totals cannot be attributed to individual providers. */
function isOpaqueDay(day: DailyEntry): boolean {
  return (day.cost > 0 || day.calls > 0) && Object.keys(day.providers).length === 0
}

/// Fold one provider's day slice into a day: the providers map, the day-level
/// totals, and (when the slice carries them) the model and category breakdowns.
function addSliceIntoDay(day: DailyEntry, provider: string, slice: ProviderDaySlice): void {
  // Reads keyed by names from foreign caches use hasOwn throughout: a plain
  // lookup of "__proto__" returns the prototype object, and accumulating into
  // it pollutes every object in the process.
  const placeholder = Object.hasOwn(day.providers, provider) ? day.providers[provider] : undefined
  const placeholderSessions = placeholder?.sessions ?? 0
  const merged: ProviderDaySlice = {
    ...slice,
    ...(slice.models ? { models: structuredClone(slice.models) } : {}),
    ...(slice.categories ? { categories: structuredClone(slice.categories) } : {}),
    ...(slice.projects ? { projects: cloneProjectStatsMap(slice.projects) } : {}),
  }
  if (placeholderSessions > (merged.sessions ?? 0)) merged.sessions = placeholderSessions
  setOwn(day.providers, provider, merged)
  day.cost += slice.cost
  day.calls += slice.calls
  day.savingsUSD += slice.savingsUSD ?? 0
  day.sessions += Math.max(0, (slice.sessions ?? 0) - placeholderSessions)
  day.inputTokens += slice.inputTokens ?? 0
  day.outputTokens += slice.outputTokens ?? 0
  if (slice.reasoningTokens !== undefined) day.reasoningTokens = (day.reasoningTokens ?? 0) + slice.reasoningTokens
  if (slice.additiveReasoningTokens !== undefined) day.additiveReasoningTokens = (day.additiveReasoningTokens ?? 0) + slice.additiveReasoningTokens
  day.cacheReadTokens += slice.cacheReadTokens ?? 0
  day.cacheWriteTokens += slice.cacheWriteTokens ?? 0
  day.editTurns += slice.editTurns ?? 0
  day.oneShotTurns += slice.oneShotTurns ?? 0
  for (const [name, m] of Object.entries(slice.models ?? {})) {
    const acc = Object.hasOwn(day.models, name) ? day.models[name]! : emptyModelStats()
    mergeModelStats(acc, m)
    setOwn(day.models, name, acc)
  }
  for (const [cat, c] of Object.entries(slice.categories ?? {})) {
    const acc = Object.hasOwn(day.categories, cat) ? day.categories[cat]! : { turns: 0, cost: 0, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 }
    acc.turns += c.turns
    acc.cost += c.cost
    acc.savingsUSD += c.savingsUSD ?? 0
    acc.editTurns += c.editTurns
    acc.oneShotTurns += c.oneShotTurns
    setOwn(day.categories, cat, acc)
  }
  const placeholderProjects = placeholder?.projects ?? {}
  for (const [name, p] of Object.entries(slice.projects ?? {})) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue
    const dayProjects = (day.projects ??= {})
    const acc = Object.hasOwn(dayProjects, name) ? dayProjects[name]! : { cost: 0, calls: 0, savingsUSD: 0, sessions: 0 }
    const targetHadUsage = hasProjectUsage(acc)
    acc.cost += num(p.cost)
    acc.calls += num(p.calls)
    acc.savingsUSD += num(p.savingsUSD)
    if (!acc.path && typeof p.path === 'string') acc.path = p.path
    const placeholderProjectSessions = Object.hasOwn(placeholderProjects, name) ? num(placeholderProjects[name]?.sessions) : 0
    acc.sessions += Math.max(0, num(p.sessions) - placeholderProjectSessions)
    addProjectTokenEvidence(acc, p, targetHadUsage)
    mergeProjectDetails(acc, p, targetHadUsage)
    setOwn(dayProjects, name, acc)
  }
  // Placeholder-only projects survive on the merged slice rather than being
  // dropped by the clone above.
  const mergedProjects = merged.projects
  if (mergedProjects) {
    for (const [name, p] of Object.entries(placeholderProjects)) {
      if (!p || typeof p !== 'object') continue
      if (Object.hasOwn(mergedProjects, name)) {
        if (num(p.sessions) > num(mergedProjects[name]!.sessions)) mergedProjects[name]!.sessions = num(p.sessions)
      } else {
        setOwn(mergedProjects, name, cloneProjectStats({ cost: 0, calls: 0, savingsUSD: 0, sessions: num(p.sessions) }))
      }
    }
  } else if (placeholder?.projects) {
    merged.projects = cloneProjectStatsMap(placeholder.projects)
  }
}

/// Assign via defineProperty so filesystem-derived keys like "__proto__" become
/// ordinary own properties instead of mutating the prototype link.
export function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/// Merge two day lists per (date, provider): `primary` wins wherever both have
/// data; `secondary` only fills dates primary lacks entirely and provider slices
/// primary lacks on shared dates. With markSecondaryCarried, every day that
/// received a secondary contribution is flagged `carried`.
export function mergeDayEntries(
  primary: DailyEntry[],
  secondary: DailyEntry[],
  markSecondaryCarried: boolean,
  blockedSecondaryProviderDays: ReadonlySet<string> = new Set(),
): DailyEntry[] {
  const byDate = new Map<string, DailyEntry>()
  for (const day of primary) byDate.set(day.date, structuredClone(day))
  for (const day of secondary) {
    const existing = byDate.get(day.date)
    if (!existing) {
      const copy = structuredClone(day)
      if (markSecondaryCarried) copy.carried = true
      byDate.set(day.date, copy)
      continue
    }
    if (isOpaqueDay(existing)) continue
    for (const [provider, slice] of Object.entries(day.providers)) {
      if (blockedSecondaryProviderDays.has(`${provider}\u0000${day.date}`)) continue
      // Sessions-only slices still carry a real session count and are worth preserving.
      if (!hasSliceData(slice) && !(slice.sessions ?? 0)) continue
      const existingSlice = Object.hasOwn(existing.providers, provider) ? existing.providers[provider] : undefined
      if (existingSlice && hasSliceData(existingSlice)) continue
      addSliceIntoDay(existing, provider, slice)
      if (markSecondaryCarried) existing.carried = true
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
