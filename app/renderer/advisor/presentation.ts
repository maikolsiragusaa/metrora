import { formatAdvisorPercent, formatAdvisorUsd, periodLabel, scopeLabel } from './evidence'
import type { AdvisorEvidence, AdvisorPresentationBlockV1, AdvisorPresentationIntent, AdvisorSynthesisDraftV1, AdvisorTurnPlanV1, AdvisorVerifiedClaimAtomV1 } from './types'

function number(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'Unavailable' : value.toLocaleString('en-US')
}

function presentationRequest(plan: AdvisorTurnPlanV1, draft: AdvisorSynthesisDraftV1 | null): AdvisorPresentationIntent {
  const requested = draft?.presentationRequests.find(request => request.kind !== 'text')?.kind
  return requested ?? plan.presentationIntent
}

function claimIdForPath(claims: readonly AdvisorVerifiedClaimAtomV1[], path: string): string[] {
  const id = claims.find(claim => claim.evidencePath === path)?.id
  return id ? [id] : []
}

function metricCards(evidence: AdvisorEvidence, claims: readonly AdvisorVerifiedClaimAtomV1[]): AdvisorPresentationBlockV1 | null {
  const values: Array<{ label: string; value: string; unit: string; detail: string; claimIds: string[] }> = []
  if (evidence.spend) {
    if (evidence.spend.measuredCostUSD !== null) values.push({ label: 'Measured spend', value: formatAdvisorUsd(evidence.spend.measuredCostUSD), unit: 'USD', detail: 'Metrora-measured cost in the selected scope.', claimIds: claimIdForPath(claims, 'spend.measuredCostUSD') })
    if (evidence.spend.calls !== null) values.push({ label: 'Calls', value: number(evidence.spend.calls), unit: 'calls', detail: 'Observed calls in the selected scope.', claimIds: claimIdForPath(claims, 'spend.calls') })
    if (evidence.spend.sessions !== null) values.push({ label: 'Sessions', value: number(evidence.spend.sessions), unit: 'sessions', detail: 'Observed sessions in the selected scope.', claimIds: claimIdForPath(claims, 'spend.sessions') })
    if (evidence.spend.inputTokens !== null && evidence.spend.inputTokens !== undefined) values.push({ label: 'Input tokens', value: number(evidence.spend.inputTokens), unit: 'tokens', detail: 'Canonical input-token total; raw prompt content is excluded.', claimIds: claimIdForPath(claims, 'spend.inputTokens') })
    if (evidence.spend.outputTokens !== null && evidence.spend.outputTokens !== undefined) values.push({ label: 'Output tokens', value: number(evidence.spend.outputTokens), unit: 'tokens', detail: 'Canonical output-token total; generated content is excluded.', claimIds: claimIdForPath(claims, 'spend.outputTokens') })
    if (evidence.spend.cacheReadTokens !== null && evidence.spend.cacheReadTokens !== undefined) values.push({ label: 'Cache read', value: number(evidence.spend.cacheReadTokens), unit: 'tokens', detail: 'Canonical cache-read token total.', claimIds: claimIdForPath(claims, 'spend.cacheReadTokens') })
    if (evidence.spend.pricingCoverage !== null) values.push({ label: 'Pricing coverage', value: formatAdvisorPercent(evidence.spend.pricingCoverage), unit: 'covered', detail: 'Canonical pricing/accounting coverage; unknown usage is not treated as free.', claimIds: [] })
  }
  if (evidence.modelEfficiency?.rows.length) {
    const lowest = evidence.modelEfficiency.rows[0]!
    values.push({ label: 'Lowest observed cost/call', value: lowest.costPerCallUSD === null ? 'Unavailable' : formatAdvisorUsd(lowest.costPerCallUSD), unit: lowest.model, detail: 'Observed comparison only; not a quality or universal model ranking.', claimIds: claimIdForPath(claims, 'modelEfficiency.rows.0.costPerCallUSD') })
  }
  if (!values.length) return null
  return { kind: 'metric-cards', title: 'At a glance', cards: values.slice(0, 6), scopeLabel: scopeLabel(evidence.scope), periodLabel: periodLabel(evidence.scope), evidenceRefs: evidence.refs }
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

function warning(evidence: AdvisorEvidence, title = 'Evidence limit'): AdvisorPresentationBlockV1 {
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
    blocks.push({ kind: 'bench-summary', title: 'Controlled Bench result', summary: evidence.coverage.detail, run: evidence.bench.latest, comparison: evidence.bench.comparison, scopeLabel: scopeLabel(evidence.scope), periodLabel: periodLabel(evidence.scope), evidenceRefs: evidence.refs })
  } else if (requested === 'evidence-disclosure') {
    blocks.push({ kind: 'evidence-disclosure', title: 'How Metrora knows', text: evidence.coverage.detail + (evidence.assumptions.length ? ' ' + evidence.assumptions[0] : ''), evidenceRefs: evidence.refs })
  }
  if (requested === 'text' && (evidence.intent === 'spend-change' || evidence.intent === 'model-efficiency')) {
    const cards = metricCards(evidence, claims)
    if (cards) blocks.push(cards)
  }
  if (evidence.coverage.level !== 'high' && !blocks.some(block => block.kind === 'warning')) blocks.push(warning(evidence))
  if (plan.expertDetailRequested && !blocks.some(block => block.kind === 'evidence-disclosure')) {
    blocks.push({ kind: 'evidence-disclosure', title: 'Evidence details', text: evidence.coverage.detail, evidenceRefs: evidence.refs })
  }
  return blocks
}
