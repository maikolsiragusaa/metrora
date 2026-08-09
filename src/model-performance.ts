import { getShortModelName } from './models.js'
import type { ProjectSummary } from './types.js'

export type ObservedModelPerformance = {
  activeDurationMs: number
  activeGeneratedTokens: number
  timingCalls: number
}

type RouteTotals = Map<string, ObservedModelPerformance>

function modelKey(model: string): string {
  return getShortModelName(model).trim().toLowerCase()
}

function routeKey(call: { modelProvider?: string; provider: string }): string {
  // A source-recorded API provider is the strongest surviving route identity.
  // Fall back to the collector only when the source did not expose one.
  return call.modelProvider
    ? `model-provider:${call.modelProvider.trim().toLowerCase()}`
    : `collector:${call.provider.trim().toLowerCase()}`
}

function addTiming(target: RouteTotals, key: string, durationMs: number, generatedTokens: number): void {
  const current = target.get(key) ?? { activeDurationMs: 0, activeGeneratedTokens: 0, timingCalls: 0 }
  current.activeDurationMs += durationMs
  current.activeGeneratedTokens += generatedTokens
  current.timingCalls += 1
  target.set(key, current)
}

/** Exact model+route timing evidence from retained source calls. */
export function aggregateModelPerformanceByRoute(projects: ProjectSummary[]): Map<string, RouteTotals> {
  const result = new Map<string, RouteTotals>()
  for (const project of projects) {
    for (const session of project.sessions) {
      // Compatibility for old cached/fixture ProjectSummary objects that only
      // carried the model rollup. Live parser output always has turns, so this
      // fallback cannot override route-aware evidence.
      const turns = session.turns ?? []
      if (turns.length === 0) {
        for (const [rawModel, data] of Object.entries(session.modelBreakdown)) {
          const durationMs = data.activeDurationMs ?? 0
          const generatedTokens = data.activeGeneratedTokens ?? (data.tokens.outputTokens + data.tokens.reasoningTokens)
          if (!(durationMs > 0) || !(generatedTokens > 0)) continue
          const model = modelKey(rawModel)
          const routes = result.get(model) ?? new Map<string, ObservedModelPerformance>()
          addTiming(routes, 'collector:unknown', durationMs, generatedTokens)
          result.set(model, routes)
        }
      }
      for (const turn of turns) {
        for (const call of turn.assistantCalls) {
          const durationMs = call.activeDurationMs ?? 0
          const generatedTokens = call.activeGeneratedTokens ?? (call.usage.outputTokens + call.usage.reasoningTokens)
          if (!(durationMs > 0) || !(generatedTokens > 0)) continue
          const model = modelKey(call.model)
          const routes = result.get(model) ?? new Map<string, ObservedModelPerformance>()
          addTiming(routes, routeKey(call), durationMs, generatedTokens)
          result.set(model, routes)
        }
      }
    }
  }
  return result
}

type EnrichableModel = {
  name: string
  modelProvider?: string
  sourceProviders?: string[]
  timingCoverage?: 'observed' | 'partial' | 'unavailable'
}

function matchingRoutes(row: EnrichableModel, routes: RouteTotals): string[] {
  if (row.modelProvider) {
    const direct = `model-provider:${row.modelProvider.trim().toLowerCase()}`
    return routes.has(direct) ? [direct] : []
  }
  const sourceMatches = (row.sourceProviders ?? [])
    .map(source => `collector:${source.trim().toLowerCase()}`)
    .filter(key => routes.has(key))
  return [...new Set(sourceMatches)]
}

/**
 * Enrich rows without copying timing between delivery routes.  When a legacy
 * row has no route identity, timing is assigned only if exactly one route is
 * evidenced for that friendly model, and only once across duplicate rows.
 */
export function enrichModelsWithObservedPerformance<T extends EnrichableModel>(models: T[], projects: ProjectSummary[]): T[] {
  const performance = aggregateModelPerformanceByRoute(projects)
  if (performance.size === 0) return models

  const usedRoutes = new Set<string>()
  return models.map(model => {
    const modelIdentity = modelKey(model.name)
    const routes = performance.get(modelIdentity)
    if (!routes || routes.size === 0) return model

    let matches = matchingRoutes(model, routes)
    if (matches.length === 0 && !model.modelProvider && (model.sourceProviders?.length ?? 0) === 0 && routes.size === 1) {
      matches = [...routes.keys()]
    }
    const available = matches.filter(key => !usedRoutes.has(`${modelIdentity}\u0000${key}`))
    if (available.length !== 1) return model
    const timing = routes.get(available[0]!)!
    usedRoutes.add(`${modelIdentity}\u0000${available[0]!}`)
    return {
      ...model,
      activeDurationMs: timing.activeDurationMs,
      activeGeneratedTokens: timing.activeGeneratedTokens,
      timingCoverage: 'observed' as const,
    }
  })
}
