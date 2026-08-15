import { homedir } from 'node:os'
import type { ProjectSummary } from './types.js'
import type { PeriodData } from './menubar-json.js'
import type { DailyEntry } from './daily-cache.js'
import { durableProjectDisplayName } from './durable-project-reconciliation.js'

type CachedProjectTotal = { cost: number; savingsUSD: number; sessions: number; path?: string }

const friendlyFromPath = (path: string | undefined, fallback: string): string => {
  if (!path) return fallback
  const home = homedir()
  if (path === home || path === home + '/') return 'Home'
  return path.split('/').filter(Boolean).pop() || fallback
}

export const friendlyProject = (p: ProjectSummary) => friendlyFromPath(p.projectPath || p.project, p.project)

const sessionDetailsOf = (p: ProjectSummary) => [...p.sessions]
  .sort((a, b) => b.totalCostUSD - a.totalCostUSD)
  .slice(0, 10)
  .map(s => ({
    cost: s.totalCostUSD,
    savingsUSD: s.totalSavingsUSD,
    calls: s.apiCalls,
    inputTokens: s.totalInputTokens,
    outputTokens: s.totalOutputTokens,
    date: s.firstTimestamp?.split('T')[0] ?? '',
    models: Object.entries(s.modelBreakdown)
      .map(([name, m]) => ({ name, cost: m.costUSD, savingsUSD: m.savingsUSD }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3),
  }))

/** Populates the project drill-down from the same durable/live sources as the headline. */
export function populateProjectRollups(
  data: PeriodData,
  scanProjects: ProjectSummary[],
  cacheDaysForPeriod: DailyEntry[] | null,
): void {
  if (cacheDaysForPeriod !== null) {
    // Carried days count here too; surviving sessions only add drill-down detail.
    const cachedTotals = new Map<string, CachedProjectTotal>()
    for (const d of cacheDaysForPeriod) {
      for (const [name, p] of Object.entries(d.projects ?? {})) {
        const acc = cachedTotals.get(name) ?? { cost: 0, savingsUSD: 0, sessions: 0 }
        acc.cost += p.cost
        acc.savingsUSD += p.savingsUSD
        acc.sessions += p.sessions
        if (!acc.path && p.path) acc.path = p.path
        cachedTotals.set(name, acc)
      }
    }
    const liveByName = new Map(scanProjects.map(p => [p.project, p]))
    const names = new Set([...cachedTotals.keys(), ...liveByName.keys()])
    data.projects = [...names].map(name => {
      const cached = cachedTotals.get(name)
      const live = liveByName.get(name)
      return {
        name: live ? friendlyProject(live) : friendlyFromPath(cached?.path, durableProjectDisplayName(name)),
        cost: cached?.cost ?? live!.totalCostUSD,
        savingsUSD: cached?.savingsUSD ?? live!.totalSavingsUSD,
        sessions: Math.max(cached?.sessions ?? 0, live?.sessions.length ?? 0),
        ...(live ? { sessionDetails: sessionDetailsOf(live) } : {}),
      }
    }).sort((a, b) => b.cost - a.cost)
  } else {
    data.projects = scanProjects.map(p => ({
      name: friendlyProject(p),
      cost: p.totalCostUSD,
      savingsUSD: p.totalSavingsUSD,
      sessions: p.sessions.length,
      sessionDetails: sessionDetailsOf(p),
    }))
  }
}
