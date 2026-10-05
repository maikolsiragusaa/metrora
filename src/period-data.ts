import { CATEGORY_LABELS, type ProjectSummary, type TaskCategory } from './types.js'
import type { PeriodData } from './menubar-json.js'
import { findUnpricedModels, isExpectedFreeModel } from './models.js'
import { scanUserCorrections, medianTimeToFirstEditMs, aggregateFileChurn, computePricingCoverage } from './workflow-insights.js'
import { combineUsageEvidence, type UsageTokenEvidence } from './token-semantics.js'

export function buildPeriodData(label: string, projects: ProjectSummary[]): PeriodData {
  const sessions = projects.flatMap(p => p.sessions)
  const catTotals: Record<string, { turns: number; cost: number; savingsUSD: number; editTurns: number; oneShotTurns: number }> = {}
  const modelTotals: Record<string, { calls: number; cost: number; savingsUSD: number; estimatedCostUSD: number; tokens: number }> = {}
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0
  let usageEvidence: UsageTokenEvidence | undefined

  for (const sess of sessions) {
    inputTokens += sess.totalInputTokens
    outputTokens += sess.totalOutputTokens
    cacheReadTokens += sess.totalCacheReadTokens
    cacheWriteTokens += sess.totalCacheWriteTokens
    for (const turn of sess.turns) {
      for (const call of turn.assistantCalls) {
        usageEvidence = combineUsageEvidence([usageEvidence, call.usageEvidence])
      }
    }
    for (const [cat, d] of Object.entries(sess.categoryBreakdown)) {
      if (!catTotals[cat]) catTotals[cat] = { turns: 0, cost: 0, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 }
      catTotals[cat].turns += d.turns
      catTotals[cat].cost += d.costUSD
      catTotals[cat].savingsUSD += d.savingsUSD
      catTotals[cat].editTurns += d.editTurns
      catTotals[cat].oneShotTurns += d.oneShotTurns
    }
    for (const [model, d] of Object.entries(sess.modelBreakdown)) {
      if (!modelTotals[model]) modelTotals[model] = { calls: 0, cost: 0, savingsUSD: 0, estimatedCostUSD: 0, tokens: 0 }
      modelTotals[model].calls += d.calls
      modelTotals[model].cost += d.costUSD
      modelTotals[model].savingsUSD += d.savingsUSD
      modelTotals[model].estimatedCostUSD += d.estimatedCostUSD ?? 0
      modelTotals[model].tokens += d.tokens.inputTokens + d.tokens.outputTokens + d.tokens.cacheReadInputTokens + d.tokens.cacheCreationInputTokens
    }
  }

  const unpricedModels = findUnpricedModels(Object.entries(modelTotals)
    .map(([model, d]) => ({ model, calls: d.calls, cost: d.cost, tokens: d.tokens })))
  const costBearingCalls = Object.entries(modelTotals)
    .reduce((s, [model, d]) => s + (model === '<synthetic>' || isExpectedFreeModel(model) ? 0 : d.calls), 0)
  const unpricedCalls = unpricedModels.reduce((s, m) => s + m.calls, 0)
  const corrections = scanUserCorrections(projects)

  return {
    label,
    cost: projects.reduce((s, p) => s + p.totalCostUSD, 0),
    savingsUSD: projects.reduce((s, p) => s + p.totalSavingsUSD, 0),
    estimatedCostUSD: projects.reduce((s, p) => s + (p.totalEstimatedCostUSD ?? 0), 0),
    calls: projects.reduce((s, p) => s + p.totalApiCalls, 0),
    sessions: projects.reduce((s, p) => s + p.sessions.length, 0),
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    ...(usageEvidence ? { usageEvidence } : {}),
    categories: Object.entries(catTotals)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([cat, d]) => ({ name: CATEGORY_LABELS[cat as TaskCategory] ?? cat, ...d })),
    models: Object.entries(modelTotals)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([name, d]) => ({ name, calls: d.calls, cost: d.cost, savingsUSD: d.savingsUSD, estimatedCostUSD: d.estimatedCostUSD })),
    unpricedModels,
    workflow: {
      corrections: corrections.corrections,
      correctionRate: corrections.correctionRate,
      medianTimeToFirstEditMs: medianTimeToFirstEditMs(projects),
    },
    topReworkedFiles: aggregateFileChurn(projects),
    pricingCoverage: computePricingCoverage(costBearingCalls, unpricedCalls),
  }
}
