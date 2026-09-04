import type {
  MetroraModelReportRow,
  MetroraOverview,
  MetroraOverviewHistoryDay,
  MetroraQuotaSnapshot,
  MetroraToolCoverage,
  MetroraToolDomain,
  MetroraToolDomainCoverage,
  MetroraToolEvidence,
  MetroraToolEvidenceRef,
  MetroraToolEvidenceState,
  MetroraToolModelEvidenceRow,
  MetroraToolQuotaProvider,
  MetroraToolScope,
  MetroraToolSpendDriver,
  MetroraToolSpendEvidence,
  MetroraToolTrend,
  MetroraToolUsagePoint,
  MetroraToolBenchEvidence,
} from './types.js'

const PERIOD_LABELS: Record<MetroraToolScope['period'], string> = {
  today: 'Today',
  week: 'Last 7 days',
  '30days': 'Last 30 days',
  month: 'This month',
  all: 'Last 6 months',
  lifetime: 'Lifetime',
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
function numberOrNull(value: unknown): number | null {
  return finite(value) ? value : null
}
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function formatMetroraToolUsd(value: number | null): string {
  if (!finite(value)) return 'unavailable'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}
export function formatMetroraToolPercent(value: number | null): string {
  return finite(value) ? Math.round(value * 100) + '%' : 'unavailable'
}
export function periodLabel(scope: Pick<MetroraToolScope, 'period' | 'range'>): string {
  if (!scope.range) return PERIOD_LABELS[scope.period]
  const from = new Date(scope.range.from + 'T12:00:00')
  const to = new Date(scope.range.to + 'T12:00:00')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'Selected date range'
  const left = from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const right = to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: from.getFullYear() === to.getFullYear() ? undefined : 'numeric' })
  return left === right ? left : left + ' – ' + right
}
export function scopeLabel(scope: MetroraToolScope): string {
  return [periodLabel(scope), scope.projectName || 'All projects', scope.provider === 'all' ? 'All providers' : scope.provider, ...(scope.model ? [scope.model] : [])].join(' · ')
}

function modelDrivers(data: MetroraOverview): MetroraToolSpendDriver[] {
  return (data.current?.topModels ?? []).filter(row => finite(row.cost) && finite(row.calls) && Boolean(row.name)).slice(0, 5).map(row => ({ name: row.name, costUSD: row.cost!, calls: row.calls! }))
}
function projectDrivers(data: MetroraOverview): MetroraToolSpendDriver[] {
  return (data.current?.topProjects ?? []).filter(row => finite(row.cost) && finite(row.sessions) && Boolean(row.name)).slice(0, 5).map(row => ({ name: row.name, costUSD: row.cost!, calls: row.sessions! }))
}
function sessionDrivers(data: MetroraOverview): MetroraToolSpendDriver[] {
  return (data.current?.topSessions ?? []).filter(row => finite(row.cost) && finite(row.calls) && row.cost! > 0).slice(0, 5).map((row, index) => ({ name: row.project || 'Session ' + (index + 1), costUSD: row.cost!, calls: row.calls! }))
}
function historyDays(data: MetroraOverview): MetroraOverviewHistoryDay[] {
  return (data.history?.daily ?? []).filter(row => typeof row.date === 'string')
}
function trendFromHistory(data: MetroraOverview): MetroraToolTrend | null {
  const history = historyDays(data).filter(row => finite(row.cost)).sort((a, b) => a.date.localeCompare(b.date))
  if (history.length < 2) return null
  const latest = history[history.length - 1]!
  const earlier = history.slice(0, -1)
  const comparisonCostUSD = earlier.reduce((sum, row) => sum + row.cost!, 0) / earlier.length
  const deltaUSD = latest.cost! - comparisonCostUSD
  return {
    direction: Math.abs(deltaUSD) < 0.005 ? 'flat' : deltaUSD > 0 ? 'up' : 'down',
    latestCostUSD: latest.cost!,
    comparisonCostUSD,
    deltaUSD,
    deltaPercent: comparisonCostUSD > 0 ? deltaUSD / comparisonCostUSD : null,
    latestDate: latest.date,
    comparisonLabel: 'average of ' + earlier.length + ' earlier day' + (earlier.length === 1 ? '' : 's'),
  }
}
function historyPoints(data: MetroraOverview): MetroraToolUsagePoint[] {
  return historyDays(data).slice(-90).map(row => ({
    date: row.date,
    costUSD: numberOrNull(row.cost),
    calls: numberOrNull(row.calls),
    inputTokens: numberOrNull(row.inputTokens),
    outputTokens: numberOrNull(row.outputTokens),
    cacheReadTokens: numberOrNull(row.cacheReadTokens),
    cacheWriteTokens: numberOrNull(row.cacheWriteTokens),
  }))
}
function modelHistoryPoints(data: MetroraOverview): MetroraToolSpendEvidence['modelHistory'] {
  const points = new Map<string, Array<{ date: string; costUSD: number | null; calls: number | null }>>()
  for (const day of historyDays(data).slice(-90)) {
    for (const row of day.topModels ?? []) {
      if (!row.name) continue
      const list = points.get(row.name) ?? []
      list.push({ date: day.date, costUSD: numberOrNull(row.cost), calls: numberOrNull(row.calls) })
      points.set(row.name, list)
    }
  }
  return Array.from(points.entries()).sort(([left], [right]) => left.localeCompare(right)).slice(0, 12).map(([model, points]) => ({ model, points }))
}
function spendCoverage(data: MetroraOverview): MetroraToolCoverage {
  const current = data.current
  if (!current) return { level: 'unavailable', state: 'UNAVAILABLE', label: 'Usage unavailable', detail: 'Metrora did not return a measured overview for the selected scope.' }
  const calls = numberOrNull(current.calls)
  const cost = numberOrNull(current.cost)
  const hasMeasuredField = calls !== null || cost !== null || finite(current.sessions)
  if (!hasMeasuredField) return { level: 'unavailable', state: 'UNAVAILABLE', label: 'Usage unavailable', detail: 'Metrora did not return a measured cost or call total for the selected scope.' }
  if (calls === 0 && (cost === null || cost === 0)) return { level: 'high', state: 'NO_DATA', label: 'No measured activity', detail: 'Metrora measured zero calls and zero spend in the selected scope.' }
  const coverage = finite(current.pricingCoverage)
    ? clamp(current.pricingCoverage)
    : finite(current.modelAccounting?.coverage?.cost)
      ? clamp(current.modelAccounting!.coverage!.cost!)
      : null
  if (coverage === null) return { level: 'partial', state: 'PARTIAL', label: 'Measured, coverage not reported', detail: 'Metrora reported totals, but complete pricing/accounting coverage is not exposed.' }
  return coverage >= 0.95
    ? { level: 'high', state: 'PARTIAL', label: formatMetroraToolPercent(coverage) + ' priced coverage', detail: 'The canonical payload reports near-complete pricing coverage.' }
    : { level: 'partial', state: 'PARTIAL', label: formatMetroraToolPercent(coverage) + ' priced coverage', detail: 'Some cost-bearing calls lack complete pricing/accounting detail.' }
}
function reconciliationCoverage(data: MetroraOverview, coverage: MetroraToolCoverage): MetroraToolCoverage {
  const state = data.freshness?.reconciliation
  if ((state !== 'degraded' && state !== 'targeted') || coverage.level !== 'high') return coverage
  return {
    level: 'partial',
    state: 'PARTIAL',
    label: state === 'degraded' ? 'Degraded source reconciliation' : 'Targeted source reconciliation',
    detail: state === 'degraded' ? 'Canonical last-good data is usable, but source reconciliation is incomplete.' : 'Only the requested reconciliation slice is current; evidence outside that slice may be incomplete.',
  }
}
function reconciliationUnknown(data: MetroraOverview): string[] {
  if (data.freshness?.reconciliation === 'degraded') return ['Source reconciliation is degraded; newly changed source data may be missing.']
  if (data.freshness?.reconciliation === 'targeted') return ['Source reconciliation was targeted; data outside the requested slice may be incomplete.']
  return []
}
function domain(domainName: MetroraToolDomain, state: MetroraToolDomainCoverage['state'], detail: string, refs: MetroraToolEvidenceRef[]): MetroraToolDomainCoverage {
  return {
    domain: domainName,
    state,
    detail,
    evidenceRefs: refs.filter(ref => {
      if (domainName === 'usage-time-series') return ref.source === 'history'
      if (domainName === 'models' || domainName === 'pricing' || domainName === 'reasoning' || domainName === 'tokens' || domainName === 'cache') return ref.source === 'models' || ref.source === 'overview'
      if (domainName === 'projects' || domainName === 'sessions' || domainName === 'usage-totals' || domainName === 'cost') return ref.source === 'overview' || ref.source === 'history'
      if (domainName === 'provider-capacity') return ref.source === 'quota'
      return true
    }),
  }
}
export function buildMetroraToolDomainCoverage(data: MetroraOverview | null, refs: MetroraToolEvidenceRef[], modelRows: MetroraModelReportRow[] = [], quotaRows: MetroraQuotaSnapshot[] = []): MetroraToolDomainCoverage[] {
  const current = data?.current
  const history = data?.history?.daily ?? []
  const hasTokens = Boolean(current && finite(current.inputTokens) && finite(current.outputTokens))
  const hasCache = Boolean(current && finite(current.cacheReadTokens) && finite(current.cacheWriteTokens))
  const hasReasoning = modelRows.some(row => finite(row.reasoningTokens) || finite(row.additiveReasoningTokens)) || Boolean(current?.modelAccounting?.rows?.some(row => finite(row.reasoningTokens) || finite(row.additiveReasoningTokens)))
  const hasPricing = Boolean(current && (finite(current.pricingCoverage) || finite(current.modelAccounting?.coverage?.cost)))
  const hasQuotaFacts = quotaRows.some(row => (row.windows?.length ?? 0) > 0 || row.planLabel !== null && row.planLabel !== undefined || row.credits !== null && row.credits !== undefined)
  const common = data ? 'Metrora returned the domain in the selected scope.' : 'No canonical Metrora overview was available.'
  return [
    domain('usage-totals', current && finite(current.calls) && finite(current.cost) ? 'available' : 'unavailable', current ? common : 'Usage totals are unavailable.', refs),
    domain('usage-time-series', history.length ? 'available' : 'unavailable', history.length ? 'Daily history is available.' : 'No daily history was returned.', refs),
    domain('cost', current && finite(current.cost) ? 'available' : 'unavailable', current && finite(current.cost) ? 'Measured cost is available.' : 'Measured cost is unavailable.', refs),
    domain('tokens', hasTokens ? 'available' : current ? 'partial' : 'unavailable', hasTokens ? 'Input and output token totals are available.' : 'Token detail is incomplete or unavailable.', refs),
    domain('cache', hasCache ? 'available' : current ? 'partial' : 'unavailable', hasCache ? 'Cache read and write totals are available.' : 'Cache detail is incomplete or unavailable.', refs),
    domain('reasoning', hasReasoning ? 'available' : 'unavailable', hasReasoning ? 'Reasoning token facts are available in canonical model rows.' : 'Reasoning facts were not returned for this scope.', refs),
    domain('models', modelRows.length || Boolean(current?.topModels?.length) ? 'available' : 'unavailable', modelRows.length ? 'Canonical model rows are available.' : 'Only limited or no model rollup was returned.', refs),
    domain('providers', current && (Boolean(current.providerDetails?.length) || Object.keys(current.providers ?? {}).length > 0) ? 'available' : 'unavailable', current ? 'Provider attribution is available.' : 'Provider attribution is unavailable.', refs),
    domain('projects', current?.topProjects?.length ? 'available' : 'unavailable', current?.topProjects?.length ? 'Project drivers are available.' : 'Project drivers are unavailable.', refs),
    domain('sessions', current?.topSessions?.length ? 'partial' : 'unavailable', current?.topSessions?.length ? 'Bounded session highlights are available; raw session content is excluded.' : 'Session highlights are unavailable.', refs),
    domain('pricing', hasPricing ? 'available' : current ? 'partial' : 'unavailable', hasPricing ? 'Canonical pricing coverage is reported.' : 'Pricing coverage is incomplete or unavailable.', refs),
    domain('freshness', data?.freshness ? data.freshness.reconciliation === 'complete' ? 'available' : 'partial' : data ? 'partial' : 'unavailable', data?.freshness ? 'Freshness and reconciliation state is reported.' : 'Freshness detail is limited.', refs),
    domain('provider-capacity', hasQuotaFacts ? 'available' : quotaRows.length ? 'partial' : 'unavailable', hasQuotaFacts ? 'Provider-reported quota facts are available.' : 'Provider capacity facts are unavailable or incomplete.', refs),
    domain('bench-history', 'unavailable', 'Bench evidence is read through the separate Bench contract.', refs),
  ]
}

export function buildMetroraSpendEvidence(question: string, scope: MetroraToolScope, data: MetroraOverview): MetroraToolEvidence {
  const modelScoped = Boolean(scope.model)
  const accountingRows = modelScoped
    ? (data.current?.modelAccounting?.rows ?? []).filter(row => row.name === scope.model && finite(row.cost) && finite(row.calls))
    : []
  const selectedModel = accountingRows.length ? {
    name: scope.model!,
    costUSD: accountingRows.reduce((sum, row) => sum + row.cost!, 0),
    calls: accountingRows.reduce((sum, row) => sum + row.calls!, 0),
  } : null
  const models = modelScoped ? selectedModel ? [selectedModel] : [] : modelDrivers(data)
  const projects = modelScoped ? [] : projectDrivers(data).filter(row => scope.projectId === 'all' || row.name === scope.projectName)
  const sessions = modelScoped ? [] : sessionDrivers(data)
  const trend = modelScoped ? null : trendFromHistory(data)
  const refs: MetroraToolEvidenceRef[] = modelScoped
    ? selectedModel ? [{ id: 'overview.modelAccounting', label: 'Canonical model accounting row', source: 'overview' }] : []
    : [{ id: 'overview.current', label: 'Measured spend and call totals', source: 'overview' }]
  if (!modelScoped && historyDays(data).length) refs.push({ id: 'overview.history.daily', label: 'Daily spend history', source: 'history' })
  if (!modelScoped && models.length) refs.push({ id: 'overview.models', label: 'Top model spend breakdown', source: 'overview' })
  if (projects.length) refs.push({ id: 'overview.projects', label: 'Top project spend breakdown', source: 'overview' })
  if (sessions.length) refs.push({ id: 'overview.sessions', label: 'Highest-cost session summaries', source: 'overview' })
  const baseCoverage = modelScoped
    ? selectedModel ? { level: 'partial' as const, label: 'Model-scoped accounting available', detail: 'Canonical model cost and calls are available; model-specific sessions and daily history are not.' } : { level: 'unavailable' as const, state: 'UNAVAILABLE' as const, label: 'Model-scoped spend unavailable', detail: 'The Overview payload has no canonical accounting row for the requested model.' }
    : spendCoverage(data)
  const coverage = reconciliationCoverage(data, baseCoverage)
  const spend: MetroraToolSpendEvidence = {
    measuredCostUSD: modelScoped ? selectedModel?.costUSD ?? null : numberOrNull(data.current?.cost),
    calls: modelScoped ? selectedModel?.calls ?? null : numberOrNull(data.current?.calls),
    sessions: modelScoped ? null : numberOrNull(data.current?.sessions),
    inputTokens: modelScoped ? null : numberOrNull(data.current?.inputTokens),
    outputTokens: modelScoped ? null : numberOrNull(data.current?.outputTokens),
    cacheReadTokens: modelScoped ? null : numberOrNull(data.current?.cacheReadTokens),
    cacheWriteTokens: modelScoped ? null : numberOrNull(data.current?.cacheWriteTokens),
    models,
    projects,
    sessionsByCost: sessions,
    trend,
    pricingCoverage: modelScoped ? null : finite(data.current?.pricingCoverage) ? clamp(data.current!.pricingCoverage!) : null,
    history: modelScoped ? [] : historyPoints(data),
    modelHistory: modelScoped ? [] : modelHistoryPoints(data),
  }
  return {
    intent: 'spend-change',
    question,
    scope,
    refs,
    coverage,
    assumptions: ['Spend and calls are Metrora-measured usage, separate from provider quota balances.', 'Drivers are descriptive rankings from the canonical payload, not causal proof.'],
    unknown: [
      ...reconciliationUnknown(data),
      ...(trend ? [] : [modelScoped ? 'Model-specific daily history is unavailable in the returned payload.' : 'A reliable latest-day comparison is unavailable in the returned history.']),
      ...(models.length || projects.length || sessions.length ? [] : ['No driver breakdown is available for this scope.']),
      ...(coverage.level === 'high' ? [] : ['Some cost-bearing usage may lack complete pricing or model attribution.']),
    ],
    nextInvestigations: ['Compare the highest-cost models for the same Project and period.', 'Inspect detailed sessions around the latest high-cost day.'],
    spend,
    domainCoverage: buildMetroraToolDomainCoverage(data, refs),
  }
}

function pricingState(row: MetroraModelReportRow): MetroraToolModelEvidenceRow['pricingState'] {
  const state = row.pricing?.state
  if (state === 'priced' || state === 'explicit-zero') return 'priced'
  if (state === 'partial') return 'partial'
  if (state === 'unavailable') return 'unavailable'
  return 'unknown'
}
function modelRow(row: MetroraModelReportRow, scope: MetroraToolScope): MetroraToolModelEvidenceRow | null {
  if (!row.model || (scope.model !== null && row.model !== scope.model)) return null
  const cost = numberOrNull(row.costUSD)
  const calls = numberOrNull(row.calls)
  if (cost === null || calls === null) return null
  const state = pricingState(row)
  return {
    model: row.model,
    provider: row.provider ?? scope.provider,
    calls,
    costUSD: cost,
    inputTokens: numberOrNull(row.inputTokens),
    outputTokens: numberOrNull(row.outputTokens),
    totalTokens: numberOrNull(row.totalTokens),
    cacheReadTokens: numberOrNull(row.cacheReadTokens),
    cacheWriteTokens: numberOrNull(row.cacheWriteTokens),
    reasoningTokens: numberOrNull(row.reasoningTokens),
    additiveReasoningTokens: numberOrNull(row.additiveReasoningTokens),
    costPerCallUSD: state === 'priced' && calls > 0 ? cost / calls : null,
    pricingState: state,
  }
}
export function buildMetroraModelEfficiencyEvidence(question: string, scope: MetroraToolScope, data: MetroraOverview, rows: MetroraModelReportRow[]): MetroraToolEvidence {
  const filtered = rows.filter(row => scope.provider === 'all' || row.provider === scope.provider || row.providerDisplayName?.toLowerCase() === scope.provider.toLowerCase())
  const canonicalRows = filtered.map(row => modelRow(row, scope)).filter((row): row is MetroraToolModelEvidenceRow => row !== null)
  if (!canonicalRows.length) {
    for (const row of data.current?.topModels ?? []) {
      const fallback = row.name && finite(row.cost) && finite(row.calls) && (!scope.model || row.name === scope.model)
        ? { model: row.name, provider: scope.provider, calls: row.calls!, costUSD: row.cost!, inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, additiveReasoningTokens: null, costPerCallUSD: null, pricingState: 'unknown' as const }
        : null
      if (fallback) canonicalRows.push(fallback)
    }
  }
  canonicalRows.sort((a, b) => (a.costPerCallUSD ?? Number.POSITIVE_INFINITY) - (b.costPerCallUSD ?? Number.POSITIVE_INFINITY))
  const limited = canonicalRows.slice(0, 12)
  const baseCoverage = !limited.length
    ? { level: 'unavailable' as const, state: 'UNAVAILABLE' as const, label: 'Model detail unavailable', detail: 'No model rows were returned for this scope.' }
    : limited.some(row => row.pricingState !== 'priced')
      ? { level: 'partial' as const, state: 'PARTIAL' as const, label: 'Partial model coverage', detail: 'One or more rows lack complete pricing or route detail.' }
      : { level: 'high' as const, label: 'Model rows available', detail: 'The selected scope returned canonical model usage rows.' }
  return {
    intent: 'model-efficiency',
    question,
    scope,
    refs: [{ id: 'models.report', label: filtered.length ? 'Canonical model usage report' : 'Canonical Overview model rollup', source: filtered.length ? 'models' : 'overview' }],
    coverage: reconciliationCoverage(data, baseCoverage),
    assumptions: ['Efficiency is represented as observed cost per call; comparable work and outcome quality are not available here.', 'Rows use canonical Metrora pricing/accounting output and are not recalculated from raw tokens.'],
    unknown: [...reconciliationUnknown(data), ...(limited.length > 1 ? ['Calls are not normalized for task complexity, output quality, or prompt size.'] : ['A multi-model comparison is unavailable in this scope.']), ...(baseCoverage.level === 'high' ? [] : ['Some model pricing or attribution is incomplete.'])],
    nextInvestigations: ['Compare these models inside the same Project and task mix.', 'Open detailed sessions to inspect retries and one-shot outcomes.'],
    modelEfficiency: { rows: limited, selectedModel: scope.model, comparableWorkWarning: limited.length > 1 },
    domainCoverage: buildMetroraToolDomainCoverage(data, [{ id: 'models.report', label: 'Canonical model usage report', source: 'models' }], limited as unknown as MetroraModelReportRow[]),
  }
}

function quotaProvider(row: MetroraQuotaSnapshot): MetroraToolQuotaProvider {
  const observed = typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))
  const freshFactual = row.freshness === 'fresh' && row.availability === 'available' && row.connection === 'connected' && observed
  const staleFactual = row.freshness === 'stale' && row.availability === 'unavailable' && observed && (row.connection === 'stale' || row.connection === 'transientFailure')
  const factual = Boolean(freshFactual || staleFactual)
  const windows = factual ? (row.windows ?? []).map(window => {
    const usedPercent = Math.round(clamp(finite(window.usedFraction) ? window.usedFraction : 0) * 100)
    return { id: window.id, label: window.label, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: window.resetsAt ?? null }
  }) : []
  return {
    provider: row.provider,
    planLabel: factual ? row.planLabel ?? null : null,
    availability: row.availability ?? 'unavailable',
    connection: row.connection ?? 'disconnected',
    freshness: row.freshness ?? 'unavailable',
    observedAt: row.observedAt ?? null,
    windows,
    creditsUSD: factual && row.credits ? numberOrNull(row.credits.balance) : null,
  }
}
function quotaCoverage(providers: MetroraToolQuotaProvider[]): MetroraToolCoverage {
  if (!providers.length) return { level: 'unavailable', state: 'UNAVAILABLE', label: 'Provider quota unavailable', detail: 'No matching provider quota snapshot was returned.' }
  const hasFacts = (row: MetroraToolQuotaProvider) => row.windows.length > 0 || row.planLabel !== null || row.creditsUSD !== null
  const factual = providers.filter(hasFacts)
  const fresh = factual.filter(row => row.freshness === 'fresh' && row.availability === 'available' && typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))).length
  const stale = factual.filter(row => row.freshness === 'stale' && typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))).length
  if (factual.length === providers.length && fresh === providers.length) return { level: 'high', label: 'Fresh provider-reported quota', detail: 'Every matching provider returned a fresh factual snapshot.' }
  if (fresh && stale) return { level: 'partial', state: 'PARTIAL', label: 'Mixed provider quota freshness', detail: 'Some matching providers are fresh while another is stale.' }
  if (stale) return { level: 'partial', state: 'STALE', label: 'Last provider snapshot is stale', detail: 'Values are retained from the last observation; the refresh did not produce a fresh provider response.' }
  if (fresh) return { level: 'partial', state: 'PARTIAL', label: 'Partial provider quota', detail: 'At least one matching provider returned facts, but coverage across the selected providers is incomplete.' }
  return { level: 'unavailable', state: 'UNAVAILABLE', label: 'Provider quota unavailable', detail: 'The provider did not return usable quota facts.' }
}
export function buildMetroraQuotaEvidence(question: string, scope: MetroraToolScope, data: MetroraOverview | null, quota: MetroraQuotaSnapshot[]): MetroraToolEvidence {
  const matching = scope.provider === 'all' ? quota : quota.filter(row => row.provider === scope.provider)
  const providers = matching.map(quotaProvider)
  const refs: MetroraToolEvidenceRef[] = providers.map(row => ({ id: 'quota.' + row.provider, label: row.provider + ' provider quota snapshot', source: 'quota' }))
  if (data) refs.push({ id: 'overview.current', label: 'Metrora-measured usage context', source: 'overview' })
  const coverage = quotaCoverage(providers)
  return {
    intent: 'quota-capacity',
    question,
    scope,
    refs,
    coverage,
    assumptions: ['Quota percentages, reset timestamps, and credits are shown only when the provider reports them.', 'A stale snapshot keeps its last observed values and is labeled stale; unavailable snapshots show no quota numbers.'],
    unknown: [...(data ? reconciliationUnknown(data) : []), ...(coverage.level === 'high' ? [] : ['A fresh provider quota response is unavailable for every matching provider.']), 'Metrora usage and provider quota use different authorities and are not combined into a burn-rate forecast.'],
    nextInvestigations: ['Refresh the provider connection if the snapshot is stale or unavailable.', 'Review Metrora usage separately in Spend before drawing capacity conclusions.'],
    quota: { providers, measuredSpendUSD: !scope.model && data ? numberOrNull(data.current?.cost) : null, measuredCalls: !scope.model && data ? numberOrNull(data.current?.calls) : null },
    domainCoverage: buildMetroraToolDomainCoverage(data, refs, [], quota),
  }
}

export function buildMetroraBenchEvidence(question: string, scope: MetroraToolScope, bench: MetroraToolBenchEvidence): MetroraToolEvidence {
  const state = bench.state
  const coverage: MetroraToolCoverage = state === 'UNAVAILABLE' || state === 'RUNTIME_UNAVAILABLE' || state === 'NO_DATA'
    ? { level: 'unavailable', state: state ?? 'UNAVAILABLE', label: 'Bench evidence unavailable', detail: 'No canonical Bench evidence was returned for the selected scope.' }
    : state === 'NOT_COMPARABLE' || state === 'PARTIAL'
      ? { level: 'partial', state, label: state === 'NOT_COMPARABLE' ? 'Bench evidence not comparable' : 'Bench evidence partial', detail: 'Canonical Bench history was read, but one or more records are incomplete or comparison-incompatible.' }
      : { level: 'high', state: 'AVAILABLE', label: 'Canonical Bench evidence available', detail: 'Bench history was read without starting a run.' }
  return {
    intent: 'bench-result',
    question,
    scope,
    refs: [{ id: 'bench.history', label: 'Canonical Bench history', source: 'bench' }],
    coverage,
    assumptions: ['Bench evidence is read-only; this tool never starts a Bench run.', 'Comparisons are shown only when the canonical Bench contract marks them compatible.'],
    unknown: coverage.level === 'high' ? [] : ['No complete compatible Bench result is available in the selected scope.'],
    nextInvestigations: ['Use the dedicated Bench surface to start a new controlled run after explicit user intent.'],
    bench,
    domainCoverage: buildMetroraToolDomainCoverage(null, [{ id: 'bench.history', label: 'Canonical Bench history', source: 'bench' }]),
  }
}

export function buildMetroraUnknownEvidence(question: string, scope: MetroraToolScope): MetroraToolEvidence {
  return {
    intent: 'unknown',
    question,
    scope,
    refs: [],
    coverage: { level: 'unavailable', state: 'UNSUPPORTED', label: 'Question needs a supported category', detail: 'Metrora currently answers measured spend, observed cost per call, provider quota, and controlled Bench questions.' },
    assumptions: [],
    unknown: ['No deterministic Metrora evidence tool is mapped to this question yet.'],
    nextInvestigations: ['Ask about a spend change or cost driver.', 'Ask which model has the lowest observed cost per call.', 'Ask what provider quota remains or when it resets.', 'Ask how a controlled Bench run performed.'],
  }
}
