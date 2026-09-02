import { formatAdvisorUsd, periodLabel, scopeLabel } from './evidence'
import type { AdvisorEvidence, AdvisorPresentationBlockV1, AdvisorPresentationIntent, AdvisorSynthesisDraftV1, AdvisorTurnPlanV1, AdvisorVerifiedClaimAtomV1 } from './types'

function number(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'Unavailable' : value.toLocaleString('en-US')
}

function presentationRequest(plan: AdvisorTurnPlanV1, draft: AdvisorSynthesisDraftV1 | null): AdvisorPresentationIntent {
  const requested = draft?.presentationRequests.find(request => request.kind !== 'text')?.kind
  return requested ?? plan.presentationIntent
}

function lineChart(evidence: AdvisorEvidence, question: string, family: AdvisorTurnPlanV1['questionFamily']): AdvisorPresentationBlockV1 | null {
  const spend = evidence.spend
  if (!spend?.history.length) return null
  const byModel = /(?:model|modello|provider|fornitore)/u.test(question)
  const metric = family === 'tokens' ? 'outputTokens' : family === 'cache' ? 'cacheReadTokens' : 'costUSD'
  const unit = metric === 'costUSD' ? 'USD' : 'tokens'
  const metricLabel = metric === 'costUSD' ? 'Total spend' : metric === 'outputTokens' ? 'Output tokens' : 'Cache read tokens'
  const series = metric === 'costUSD' && byModel && spend.modelHistory.length
    ? spend.modelHistory.slice(0, 8).map(item => ({ id: item.model, label: item.model, points: item.points.slice(-30).map(point => ({ label: point.date, value: point.costUSD })) }))
    : [{ id: 'total', label: metricLabel, points: spend.history.slice(-30).map(point => ({ label: point.date, value: metric === 'costUSD' ? point.costUSD : metric === 'outputTokens' ? point.outputTokens : point.cacheReadTokens })) }]
  const pointCount = series.reduce((sum, item) => sum + item.points.length, 0)
  if (!pointCount) return null
  return {
    kind: 'line-chart',
    title: metric === 'costUSD' && byModel ? 'Spend by model over time' : metric === 'costUSD' ? 'Spend over time' : metricLabel + ' over time',
    summary: 'Verified Metrora usage history for ' + periodLabel(evidence.scope) + '; gaps remain unavailable rather than zero-filled.',
    unit,
    scopeLabel: scopeLabel(evidence.scope),
    periodLabel: periodLabel(evidence.scope),
    series,
    evidenceRefs: evidence.refs.filter(ref => ref.source === 'history' || ref.source === 'overview'),
    accessibilityLabel: 'Line chart of Metrora-measured spend in USD by day, scoped to ' + scopeLabel(evidence.scope),
  }
}

function barChart(evidence: AdvisorEvidence): AdvisorPresentationBlockV1 | null {
  const rows = evidence.modelEfficiency?.rows ?? []
  const points = rows.length
    ? rows.slice(0, 12).map(row => ({ label: row.model, value: row.costPerCallUSD }))
    : (evidence.spend?.models ?? []).slice(0, 12).map(row => ({ label: row.name, value: row.costUSD }))
  if (!points.length || points.every(point => point.value === null)) return null
  return {
    kind: 'bar-chart',
    title: rows.length ? 'Observed cost per call by model' : 'Measured spend by model',
    summary: rows.length ? 'Observed cost per call from canonical model rows; this does not measure quality.' : 'Measured model spend in the selected scope.',
    unit: 'USD',
    scopeLabel: scopeLabel(evidence.scope),
    periodLabel: periodLabel(evidence.scope),
    series: [{ id: 'models', label: rows.length ? 'Cost per call' : 'Spend', points }],
    evidenceRefs: evidence.refs,
    accessibilityLabel: 'Bar chart of observed Metrora model values in USD, scoped to ' + scopeLabel(evidence.scope),
  }
}

function driverPricingState(cost: unknown): 'priced' | 'unavailable' {
  return typeof cost === 'number' && Number.isFinite(cost) ? 'priced' : 'unavailable'
}

function comparisonTable(evidence: AdvisorEvidence, family: AdvisorTurnPlanV1['questionFamily']): AdvisorPresentationBlockV1 | null {
  const modelRows = evidence.modelEfficiency?.rows ?? []
  const driverRows = family === 'projects' ? (evidence.spend?.projects ?? []).map(row => ({ model: row.name, provider: 'Project', calls: row.calls, costUSD: row.costUSD, costPerCallUSD: null, pricingState: driverPricingState(row.costUSD) }))
    : family === 'sessions' ? (evidence.spend?.sessionsByCost ?? []).map(row => ({ model: row.name, provider: 'Session', calls: row.calls, costUSD: row.costUSD, costPerCallUSD: null, pricingState: driverPricingState(row.costUSD) }))
      : []
  const rows = modelRows.length ? modelRows : driverRows
  if (!rows.length) return null
  const driverCostLabel = (name: string): string => {
    const cost = driverRows.find(item => item.model === name)?.costUSD
    return typeof cost === 'number' && Number.isFinite(cost) ? formatAdvisorUsd(cost) : 'Unavailable'
  }
  return {
    kind: 'comparison-table',
    title: modelRows.length ? 'Observed model comparison' : family === 'projects' ? 'Observed Project drivers' : 'Observed session highlights',
    summary: modelRows.length ? 'Canonical usage rows compared within the selected scope. Comparable work and quality are not established.' : 'Bounded canonical drivers in the selected scope; raw session content is excluded.',
    table: {
      columns: ['Name', 'Source', 'Calls', modelRows.length ? 'Cost/call' : 'Measured cost', 'Pricing'],
      rows: rows.slice(0, 12).map(row => [row.model, row.provider, number(row.calls), row.costPerCallUSD === null ? modelRows.length ? 'Unavailable' : driverCostLabel(row.model) : formatAdvisorUsd(row.costPerCallUSD), row.pricingState]),
    },
    scopeLabel: scopeLabel(evidence.scope),
    periodLabel: periodLabel(evidence.scope),
    evidenceRefs: evidence.refs,
  }
}

function warning(evidence: AdvisorEvidence, title = 'Sources'): AdvisorPresentationBlockV1 {
  return { kind: 'warning', title, text: evidence.coverage.detail + (evidence.unknown.length ? ' ' + evidence.unknown[0] : ''), evidenceRefs: evidence.refs }
}

export function buildAdvisorPresentationBlocks(evidence: AdvisorEvidence, plan: AdvisorTurnPlanV1, question: string, draft: AdvisorSynthesisDraftV1 | null = null, claims: readonly AdvisorVerifiedClaimAtomV1[] = []): AdvisorPresentationBlockV1[] {
  const requested = presentationRequest(plan, draft)
  const blocks: AdvisorPresentationBlockV1[] = []
  if (requested === 'line-chart') {
    const chart = lineChart(evidence, question, plan.questionFamily)
    blocks.push(chart ?? warning(evidence, 'Chart unavailable'))
  } else if (requested === 'bar-chart') {
    const chart = barChart(evidence)
    blocks.push(chart ?? warning(evidence, 'Chart unavailable'))
  } else if (requested === 'comparison-table') {
    const table = comparisonTable(evidence, plan.questionFamily)
    blocks.push(table ?? warning(evidence, 'Comparison unavailable'))
  } else if (requested === 'quota-card' && evidence.quota) {
    blocks.push({ kind: 'quota-card', title: 'Provider quota', summary: 'Provider-reported quota is separate from Metrora-measured usage.', providers: evidence.quota.providers, scopeLabel: scopeLabel(evidence.scope), periodLabel: periodLabel(evidence.scope), evidenceRefs: evidence.refs })
  } else if (requested === 'bench-summary' && evidence.bench) {
    blocks.push({ kind: 'bench-summary', title: 'Controlled Bench result', summary: evidence.coverage.detail, run: evidence.bench.latest, comparison: evidence.bench.comparison, performance: evidence.bench.performance, scopeLabel: scopeLabel(evidence.scope), periodLabel: periodLabel(evidence.scope), evidenceRefs: evidence.refs })
  } else if (requested === 'evidence-disclosure') {
    blocks.push({ kind: 'evidence-disclosure', title: 'How Metrora knows', text: evidence.coverage.detail + (evidence.assumptions.length ? ' ' + evidence.assumptions[0] : ''), evidenceRefs: evidence.refs })
  }
  // A plain conversational turn keeps the answer in the conversation. Large
  // metric blocks are reserved for an explicit presentation request or an
  // intentionally visual plan such as quota, Bench, chart, or comparison.
  if (evidence.coverage.level !== 'high' && !blocks.some(block => block.kind === 'warning')) blocks.push(warning(evidence))
  if (plan.expertDetailRequested && !blocks.some(block => block.kind === 'evidence-disclosure')) {
    blocks.push({ kind: 'evidence-disclosure', title: 'Evidence details', text: evidence.coverage.detail, evidenceRefs: evidence.refs })
  }
  return blocks
}
