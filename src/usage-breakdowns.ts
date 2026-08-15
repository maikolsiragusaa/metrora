import type { ProjectSummary } from './types.js'
import type { BreakdownArrays } from './menubar-json.js'
import { getShortModelName } from './models.js'

/** Builds the bounded tool, skill, subagent, MCP, and local-savings payload sections. */
export function buildUsageBreakdowns(scanProjects: ProjectSummary[]): BreakdownArrays {
  const toolMap: Record<string, number> = {}
  const skillMap: Record<string, { turns: number; cost: number }> = {}
  const subagentMap: Record<string, { calls: number; cost: number }> = {}
  const mcpMap: Record<string, number> = {}
  // Local-model savings rollup: avoided spend grouped by model and provider.
  const savingsByModel = new Map<string, { calls: number; actualUSD: number; savingsUSD: number; baselineModel: string; inputTokens: number; outputTokens: number }>()
  const savingsByProvider = new Map<string, { calls: number; savingsUSD: number }>()
  let totalSavings = 0
  let totalSavingsCalls = 0

  for (const p of scanProjects) for (const s of p.sessions) {
    for (const [t, d] of Object.entries(s.toolBreakdown)) { if (!t.startsWith('lang:')) toolMap[t] = (toolMap[t] ?? 0) + d.calls }
    for (const [sk, d] of Object.entries(s.skillBreakdown)) { const e = skillMap[sk] ?? { turns: 0, cost: 0 }; e.turns += d.turns; e.cost += d.costUSD; skillMap[sk] = e }
    for (const [sa, d] of Object.entries(s.subagentBreakdown)) { const e = subagentMap[sa] ?? { calls: 0, cost: 0 }; e.calls += d.calls; e.cost += d.costUSD; subagentMap[sa] = e }
    for (const [m, d] of Object.entries(s.mcpBreakdown)) { mcpMap[m] = (mcpMap[m] ?? 0) + d.calls }
    for (const turn of s.turns) for (const call of turn.assistantCalls) {
      if (!call.savingsUSD || call.savingsUSD <= 0) continue
      totalSavings += call.savingsUSD
      totalSavingsCalls += 1
      const modelKey = getShortModelName(call.model)
      const acc = savingsByModel.get(modelKey) ?? { calls: 0, actualUSD: 0, savingsUSD: 0, baselineModel: call.savingsBaselineModel ?? '', inputTokens: 0, outputTokens: 0 }
      acc.calls += 1
      acc.actualUSD += call.costUSD
      acc.savingsUSD += call.savingsUSD
      acc.baselineModel = acc.baselineModel || (call.savingsBaselineModel ?? '')
      acc.inputTokens += call.usage.inputTokens
      acc.outputTokens += call.usage.outputTokens
      savingsByModel.set(modelKey, acc)
      const provAcc = savingsByProvider.get(call.provider) ?? { calls: 0, savingsUSD: 0 }
      provAcc.calls += 1
      provAcc.savingsUSD += call.savingsUSD
      savingsByProvider.set(call.provider, provAcc)
    }
  }

  return {
    tools: Object.entries(toolMap).sort(([, a], [, b]) => b - a).slice(0, 10).map(([name, calls]) => ({ name, calls })),
    skills: Object.entries(skillMap).sort(([, a], [, b]) => b.cost - a.cost).slice(0, 10).map(([name, d]) => ({ name, ...d })),
    subagents: Object.entries(subagentMap).sort(([, a], [, b]) => b.cost - a.cost).slice(0, 10).map(([name, d]) => ({ name, ...d })),
    mcpServers: Object.entries(mcpMap).sort(([, a], [, b]) => b - a).slice(0, 10).map(([name, calls]) => ({ name, calls })),
    localModelSavings: {
      totalUSD: totalSavings,
      calls: totalSavingsCalls,
      byModel: Array.from(savingsByModel.entries()).sort(([, a], [, b]) => b.savingsUSD - a.savingsUSD).slice(0, 5).map(([name, d]) => ({ name, ...d })),
      byProvider: Array.from(savingsByProvider.entries()).sort(([, a], [, b]) => b.savingsUSD - a.savingsUSD).slice(0, 5).map(([name, d]) => ({ name, ...d })),
    },
  }
}
