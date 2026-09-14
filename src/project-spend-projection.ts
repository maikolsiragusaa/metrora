import type { MenubarPayload, PeriodData } from './menubar-json.js'

const TOP_PROJECTS_LIMIT = 5

export type ProjectSpendProjection = {
  name: string
  cost: number
  savingsUSD: number
  sessions: number
  calls?: number
  avgCostPerSession: number
  dailySpend?: Array<{ date: string; cost: number }>
  sessionDetails?: Array<{
    cost: number
    savingsUSD: number
    calls: number
    inputTokens: number
    outputTokens: number
    date: string
    models: Array<{ name: string; cost: number; savingsUSD: number }>
  }>
}

export function buildTopProjects(projects: PeriodData['projects']): MenubarPayload['current']['topProjects'] {
  return (projects ?? [])
    .filter(p => p.cost > 0 || p.savingsUSD > 0)
    .sort((a, b) => (b.cost + b.savingsUSD) - (a.cost + a.savingsUSD))
    .slice(0, TOP_PROJECTS_LIMIT)
    .map(p => ({
      name: p.name,
      cost: p.cost,
      savingsUSD: p.savingsUSD,
      sessions: p.sessions,
      avgCostPerSession: p.sessions > 0 ? p.cost / p.sessions : 0,
      sessionDetails: (p.sessionDetails ?? []).map(s => ({
        cost: s.cost,
        savingsUSD: s.savingsUSD,
        calls: s.calls,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        date: s.date,
        models: s.models,
      })),
    }))
}

export function buildProjectSpend(projects: PeriodData['projects']): ProjectSpendProjection[] {
  return (projects ?? [])
    .filter(p => p.cost > 0 || p.savingsUSD > 0 || p.sessions > 0 || (p.calls ?? 0) > 0)
    .sort((a, b) => (b.cost + b.savingsUSD) - (a.cost + a.savingsUSD))
    .map(p => ({
      name: p.name,
      cost: p.cost,
      savingsUSD: p.savingsUSD,
      sessions: p.sessions,
      ...(typeof p.calls === 'number' ? { calls: p.calls } : {}),
      avgCostPerSession: p.sessions > 0 ? p.cost / p.sessions : 0,
      ...(p.dailySpend && p.dailySpend.length > 0 ? { dailySpend: p.dailySpend } : {}),
      ...(p.sessionDetails && p.sessionDetails.length > 0 ? {
        sessionDetails: p.sessionDetails.map(s => ({
          cost: s.cost,
          savingsUSD: s.savingsUSD,
          calls: s.calls,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          date: s.date,
          models: s.models,
        })),
      } : {}),
    }))
}
