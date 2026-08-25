import { formatUsd } from '../lib/format'
import type { MenubarPayload, ModelReportRow, Period, QuotaProvider } from '../lib/types'
import type {
  AdvisorBenchEvidence,
  AdvisorCoverage,
  AdvisorDomainCoverageV1,
  AdvisorEvidence,
  AdvisorEvidenceRef,
  AdvisorEvidenceState,
  AdvisorIntent,
  AdvisorModelEvidenceRow,
  AdvisorQuotaProvider,
  AdvisorQuotaWindow,
  AdvisorScope,
  AdvisorSpendEvidence,
  AdvisorSpendDriver,
  AdvisorTrend,
} from './types'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: 'Last 7 days',
  '30days': 'Last 30 days',
  month: 'This month',
  all: 'Last 6 months',
  lifetime: 'Lifetime',
}
const USD_CREDITS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
export function formatAdvisorUsd(value: number): string {
  return finite(value) ? formatUsd(value) : 'unavailable'
}
export function formatAdvisorCreditsUsd(value: number): string {
  return finite(value) ? USD_CREDITS.format(value) : 'unavailable'
}
export function formatAdvisorPercent(value: number): string {
  return finite(value) ? Math.round(value * 100) + '%' : 'unavailable'
}
export function periodLabel(scope: Pick<AdvisorScope, 'period' | 'range'>): string {
  if (!scope.range) return PERIOD_LABELS[scope.period]
  const from = new Date(scope.range.from + 'T12:00:00')
  const to = new Date(scope.range.to + 'T12:00:00')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'Selected date range'
  const left = from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const right = to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: from.getFullYear() === to.getFullYear() ? undefined : 'numeric' })
  return left === right ? left : left + ' – ' + right
}
export function scopeLabel(scope: AdvisorScope): string {
  const parts = [periodLabel(scope), scope.projectName || 'All projects', scope.provider === 'all' ? 'All providers' : scope.provider]
  if (scope.model) parts.push(scope.model)
  return parts.join(' · ')
}
function normalize(question: string): string {
  return question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}
export function classifyAdvisorQuestion(question: string): AdvisorIntent {
  const value = normalize(question)
  if (/\b(?:bench|controlled test|task pack|benchmark|test controllato|prova controllata)\b/u.test(value)) return 'bench-result'
  if (/\b(?:best|smartest|better overall|which model should|which model to buy|modello migliore|piu intelligente|migliore in assoluto|consigli|recommend)\b/u.test(value)) return 'unsupported'
  if (/\blimit(?:s)?\b|\blimite\b/u.test(value) && !/(?:quota|capacity|reset|remaining|credit|provider|codex|claude|usage|spend|spent|cost|costo|spesa)/u.test(value)) return 'clarification'
  if (/(quota|capacity|limit|reset|remaining|exhaust|rate.?limit|credit|disponibil|limite|esaur)/.test(value)) return 'quota-capacity'
  if (/(why did|what caused|cause|driver|drove|spend|spent|cost me the most|most expensive|increase|increas|change|changed|spike|which project|which sessions?|unusually expensive|expensive sessions?|versus|vs\b|costo|spesa|aument|picco|perche|perché)/.test(value)) return 'spend-change'
  if (/(model efficiency|lower observed cost per call|cheaper per observed call|cost per call|per observed call|which model.*(?:lower|cheaper)|compare.*model.*(?:cost|efficien)|efficien|efficient|econom|modello)/.test(value)) return 'model-efficiency'
  return 'unknown'
}
function modelDrivers(data: MenubarPayload): AdvisorSpendDriver[] {
  return data.current.topModels.filter(row => finite(row.cost) && finite(row.calls) && row.name).slice(0, 5).map(row => ({ name: row.name, costUSD: row.cost, calls: row.calls }))
}
function projectDrivers(data: MenubarPayload): AdvisorSpendDriver[] {
  return data.current.topProjects.filter(row => finite(row.cost) && finite(row.sessions) && row.name).slice(0, 5).map(row => ({ name: row.name, costUSD: row.cost, calls: row.sessions }))
}
function sessionDrivers(data: MenubarPayload): AdvisorSpendDriver[] {
  return data.current.topSessions.filter(row => finite(row.cost) && finite(row.calls) && row.cost > 0).slice(0, 5).map((row, index) => ({ name: row.project || 'Session ' + (index + 1), costUSD: row.cost, calls: row.calls }))
}
function trendFromHistory(data: MenubarPayload): AdvisorTrend | null {
  const history = data.history.daily.filter(row => typeof row.date === 'string' && finite(row.cost)).sort((a, b) => a.date.localeCompare(b.date))
  if (history.length < 2) return null
  const latest = history[history.length - 1]!
  const earlier = history.slice(0, -1)
  const comparisonCostUSD = earlier.reduce((sum, row) => sum + row.cost, 0) / earlier.length
  const deltaUSD = latest.cost - comparisonCostUSD
  return {
    direction: Math.abs(deltaUSD) < 0.005 ? 'flat' : deltaUSD > 0 ? 'up' : 'down',
    latestCostUSD: latest.cost,
    comparisonCostUSD,
    deltaUSD,
    deltaPercent: comparisonCostUSD > 0 ? deltaUSD / comparisonCostUSD : null,
    latestDate: latest.date,
    comparisonLabel: 'average of ' + earlier.length + ' earlier day' + (earlier.length === 1 ? '' : 's'),
  }
}
function spendCoverage(data: MenubarPayload): AdvisorCoverage {
  const calls = finite(data.current.calls) ? data.current.calls : null
  const cost = finite(data.current.cost) ? data.current.cost : null
  const hasMeasuredField = calls !== null || cost !== null || finite(data.current.sessions)
  if (!hasMeasuredField) return { level: 'unavailable', state: 'UNAVAILABLE', label: 'Usage unavailable', detail: 'Metrora did not return a measured cost or call total for the selected scope.' }
  if (calls === 0 && (cost === null || cost === 0)) return { level: 'high', state: 'NO_DATA', label: 'No measured activity', detail: 'Metrora measured zero calls and zero spend in the selected scope.' }
  const coverage = finite(data.current.pricingCoverage)
    ? clamp(data.current.pricingCoverage)
    : data.current.modelAccounting && finite(data.current.modelAccounting.coverage.cost)
      ? clamp(data.current.modelAccounting.coverage.cost)
      : null
  if (coverage === null) return { level: 'partial', state: 'PARTIAL', label: 'Measured, coverage not reported', detail: 'Metrora reported totals, but complete pricing/accounting coverage is not exposed.' }
  return coverage >= 0.95
    ? { level: 'high', state: 'PARTIAL', label: formatAdvisorPercent(coverage) + ' priced coverage', detail: 'The canonical payload reports near-complete pricing coverage.' }
    : { level: 'partial', state: 'PARTIAL', label: formatAdvisorPercent(coverage) + ' priced coverage', detail: 'Some cost-bearing calls lack complete pricing/accounting detail.' }
}
function reconciliationCoverage(data: MenubarPayload, coverage: AdvisorCoverage): AdvisorCoverage {
  const state = data.freshness?.reconciliation
  if ((state !== 'degraded' && state !== 'targeted') || coverage.level !== 'high') return coverage
  return {
    level: 'partial',
    state: 'PARTIAL',
    label: state === 'degraded' ? 'Degraded source reconciliation' : 'Targeted source reconciliation',
    detail: state === 'degraded'
      ? 'Canonical last-good data is usable, but source reconciliation is incomplete.'
      : 'Only the requested reconciliation slice is current; evidence outside that slice may be incomplete.',
  }
}
function reconciliationUnknown(data: MenubarPayload): string[] {
  if (data.freshness?.reconciliation === 'degraded') return ['Source reconciliation is degraded; newly changed source data may be missing.']
  if (data.freshness?.reconciliation === 'targeted') return ['Source reconciliation was targeted; data outside the requested slice may be incomplete.']
  return []
}

function domain(domain: AdvisorDomainCoverageV1['domain'], state: AdvisorDomainCoverageV1['state'], detail: string, refs: AdvisorEvidenceRef[]): AdvisorDomainCoverageV1 {
  return { domain, state, detail, evidenceRefs: refs.filter(ref => {
    if (domain === 'usage-time-series') return ref.source === 'history'
    if (domain === 'models' || domain === 'pricing' || domain === 'reasoning' || domain === 'tokens' || domain === 'cache') return ref.source === 'models' || ref.source === 'overview'
    if (domain === 'projects' || domain === 'sessions' || domain === 'usage-totals' || domain === 'cost') return ref.source === 'overview' || ref.source === 'history'
    if (domain === 'provider-capacity') return ref.source === 'quota'
    return true
  }) }
}

export function buildDomainCoverage(data: MenubarPayload | null, refs: AdvisorEvidenceRef[], modelRows: Array<ModelReportRow | AdvisorModelEvidenceRow> = [], quotaRows: QuotaProvider[] = []): AdvisorDomainCoverageV1[] {
  const current = data?.current
  const history = data?.history.daily ?? []
  const hasNumber = (value: unknown): value is number => finite(value)
  const hasTokens = Boolean(current && [current.inputTokens, current.outputTokens].every(hasNumber))
  const hasCache = Boolean(current && [current.cacheReadTokens, current.cacheWriteTokens].every(hasNumber))
  const hasReasoning = modelRows.some(row => ('reasoningTokens' in row && hasNumber(row.reasoningTokens)) || ('additiveReasoningTokens' in row && hasNumber(row.additiveReasoningTokens)))
    || Boolean(current?.modelAccounting?.rows.some(row => hasNumber(row.reasoningTokens) || hasNumber(row.additiveReasoningTokens)))
  const hasPricing = Boolean(current && (hasNumber(current.pricingCoverage) || (current.modelAccounting && hasNumber(current.modelAccounting.coverage.cost))))
  const hasQuotaFacts = quotaRows.some(row => row.windows.length > 0 || row.planLabel !== null || row.credits !== null)
  const common = data ? 'Metrora returned the domain in the selected scope.' : 'No canonical Metrora overview was available.'
  return [
    domain('usage-totals', current && hasNumber(current.calls) && hasNumber(current.cost) ? 'available' : 'unavailable', current ? common : 'Usage totals are unavailable.', refs),
    domain('usage-time-series', history.length ? 'available' : 'unavailable', history.length ? 'Daily history is available.' : 'No daily history was returned.', refs),
    domain('cost', current && hasNumber(current.cost) ? 'available' : 'unavailable', current && hasNumber(current.cost) ? 'Measured cost is available.' : 'Measured cost is unavailable.', refs),
    domain('tokens', hasTokens ? 'available' : current ? 'partial' : 'unavailable', hasTokens ? 'Input and output token totals are available.' : 'Token detail is incomplete or unavailable.', refs),
    domain('cache', hasCache ? 'available' : current ? 'partial' : 'unavailable', hasCache ? 'Cache read and write totals are available.' : 'Cache detail is incomplete or unavailable.', refs),
    domain('reasoning', hasReasoning ? 'available' : modelRows.length || current ? 'unavailable' : 'unavailable', hasReasoning ? 'Reasoning token facts are available in canonical model rows.' : 'Reasoning facts were not returned for this scope.', refs),
    domain('models', modelRows.length || Boolean(current?.topModels.length) ? 'available' : 'unavailable', modelRows.length ? 'Canonical model rows are available.' : 'Only limited or no model rollup was returned.', refs),
    domain('providers', current && (Boolean(current.providerDetails?.length) || Object.keys(current.providers ?? {}).length > 0) ? 'available' : 'unavailable', current && (Boolean(current.providerDetails?.length) || Object.keys(current.providers ?? {}).length > 0) ? 'Provider attribution is available.' : 'Provider attribution is unavailable.', refs),
    domain('projects', current?.topProjects.length ? 'available' : 'unavailable', current?.topProjects.length ? 'Project drivers are available.' : 'Project drivers are unavailable.', refs),
    domain('sessions', current?.topSessions.length ? 'partial' : 'unavailable', current?.topSessions.length ? 'Bounded session highlights are available; raw session content is excluded.' : 'Session highlights are unavailable.', refs),
    domain('pricing', hasPricing ? 'available' : current ? 'partial' : 'unavailable', hasPricing ? 'Canonical pricing coverage is reported.' : 'Pricing coverage is incomplete or unavailable.', refs),
    domain('freshness', data?.freshness ? data.freshness.reconciliation === 'complete' ? 'available' : 'partial' : data ? 'partial' : 'unavailable', data?.freshness ? 'Freshness and reconciliation state is reported.' : 'Freshness detail is limited.', refs),
    domain('provider-capacity', hasQuotaFacts ? 'available' : quotaRows.length ? 'partial' : 'unavailable', hasQuotaFacts ? 'Provider-reported quota facts are available.' : 'Provider capacity facts are unavailable or incomplete.', refs),
    domain('bench-history', 'unavailable', 'Bench evidence is read through the separate Bench contract.', refs),
  ]
}

function historyPoints(data: MenubarPayload): AdvisorSpendEvidence['history'] {
  return data.history.daily.filter(row => typeof row.date === 'string').slice(-90).map(row => ({
    date: row.date,
    costUSD: finite(row.cost) ? row.cost : null,
    calls: finite(row.calls) ? row.calls : null,
    inputTokens: finite(row.inputTokens) ? row.inputTokens : null,
    outputTokens: finite(row.outputTokens) ? row.outputTokens : null,
    cacheReadTokens: finite(row.cacheReadTokens) ? row.cacheReadTokens : null,
    cacheWriteTokens: finite(row.cacheWriteTokens) ? row.cacheWriteTokens : null,
  }))
}

function modelHistoryPoints(data: MenubarPayload): AdvisorSpendEvidence['modelHistory'] {
  const points = new Map<string, Array<{ date: string; costUSD: number | null; calls: number | null }>>()
  for (const day of data.history.daily.slice(-90)) {
    for (const row of day.topModels ?? []) {
      if (!row.name) continue
      const list = points.get(row.name) ?? []
      list.push({ date: day.date, costUSD: finite(row.cost) ? row.cost : null, calls: finite(row.calls) ? row.calls : null })
      points.set(row.name, list)
    }
  }
  return Array.from(points.entries()).sort(([left], [right]) => left.localeCompare(right)).slice(0, 12).map(([model, modelPoints]) => ({ model, points: modelPoints }))
}
export function buildSpendEvidence(question: string, scope: AdvisorScope, data: MenubarPayload): AdvisorEvidence {
  const modelScoped = Boolean(scope.model)
  const accountingRows = modelScoped
    ? (data.current.modelAccounting?.rows ?? []).filter(row => row.name === scope.model && finite(row.cost) && finite(row.calls))
    : []
  const selectedModel = accountingRows.length ? {
    name: scope.model!,
    costUSD: accountingRows.reduce((sum, row) => sum + row.cost, 0),
    calls: accountingRows.reduce((sum, row) => sum + row.calls, 0),
  } : null
  const models = modelScoped ? (selectedModel ? [selectedModel] : []) : modelDrivers(data)
  const projects = modelScoped ? [] : projectDrivers(data).filter(row => scope.projectId === 'all' || row.name === scope.projectName)
  const sessions = modelScoped ? [] : sessionDrivers(data)
  const trend = modelScoped ? null : trendFromHistory(data)
  const refs: AdvisorEvidenceRef[] = modelScoped
    ? (selectedModel ? [{ id: 'overview.modelAccounting', label: 'Canonical model accounting row', source: 'overview' }] : [])
    : [{ id: 'overview.current', label: 'Measured spend and call totals', source: 'overview' }]
  if (!modelScoped && data.history.daily.length) refs.push({ id: 'overview.history.daily', label: 'Daily spend history', source: 'history' })
  if (!modelScoped && models.length) refs.push({ id: 'overview.models', label: 'Top model spend breakdown', source: 'overview' })
  if (projects.length) refs.push({ id: 'overview.projects', label: 'Top project spend breakdown', source: 'overview' })
  if (sessions.length) refs.push({ id: 'overview.sessions', label: 'Highest-cost session summaries', source: 'overview' })
  const baseCoverage: AdvisorCoverage = modelScoped
    ? selectedModel
      ? { level: 'partial', label: 'Model-scoped accounting available', detail: 'Canonical model cost and calls are available; model-specific sessions and daily history are not.' }
      : { level: 'unavailable', label: 'Model-scoped spend unavailable', detail: 'The Overview payload has no canonical accounting row for the requested model.' }
    : spendCoverage(data)
  const coverage = reconciliationCoverage(data, baseCoverage)
  return {
    intent: 'spend-change',
    question,
    scope,
    refs,
    coverage,
    assumptions: [
      'Spend and calls are Metrora-measured usage, separate from provider quota balances.',
      'Drivers are descriptive rankings from the canonical payload, not causal proof.',
    ],
    unknown: [
      ...reconciliationUnknown(data),
      ...(trend ? [] : [modelScoped ? 'Model-specific daily history is unavailable in the returned payload.' : 'A reliable latest-day comparison is unavailable in the returned history.']),
      ...(models.length || projects.length || sessions.length ? [] : ['No driver breakdown is available for this scope.']),
      ...(coverage.level === 'high' ? [] : ['Some cost-bearing usage may lack complete pricing or model attribution.']),
    ],
    nextInvestigations: ['Compare the highest-cost models for the same Project and period.', 'Inspect detailed sessions around the latest high-cost day.'],
    spend: {
      measuredCostUSD: modelScoped ? selectedModel?.costUSD ?? null : finite(data.current.cost) ? data.current.cost : null,
      calls: modelScoped ? selectedModel?.calls ?? null : finite(data.current.calls) ? data.current.calls : null,
      sessions: modelScoped ? null : finite(data.current.sessions) ? data.current.sessions : null,
      inputTokens: modelScoped ? null : finite(data.current.inputTokens) ? data.current.inputTokens : null,
      outputTokens: modelScoped ? null : finite(data.current.outputTokens) ? data.current.outputTokens : null,
      cacheReadTokens: modelScoped ? null : finite(data.current.cacheReadTokens) ? data.current.cacheReadTokens : null,
      cacheWriteTokens: modelScoped ? null : finite(data.current.cacheWriteTokens) ? data.current.cacheWriteTokens : null,
      models,
      projects,
      sessionsByCost: sessions,
      trend,
      pricingCoverage: modelScoped ? null : finite(data.current.pricingCoverage) ? clamp(data.current.pricingCoverage) : null,
      history: modelScoped ? [] : historyPoints(data),
      modelHistory: modelScoped ? [] : modelHistoryPoints(data),
    },
    domainCoverage: buildDomainCoverage(data, refs),
  }
}
function pricingState(row: ModelReportRow): AdvisorModelEvidenceRow['pricingState'] {
  const state = row.pricing?.state
  if (state === 'priced' || state === 'explicit-zero') return 'priced'
  if (state === 'partial') return 'partial'
  if (state === 'unavailable') return 'unavailable'
  return 'unknown'
}
function fallbackModels(data: MenubarPayload, scope: AdvisorScope): AdvisorModelEvidenceRow[] {
  return data.current.topModels.filter(row => finite(row.cost) && finite(row.calls) && (!scope.model || row.name === scope.model)).map(row => ({
    model: row.name,
    provider: scope.provider,
    calls: row.calls,
    costUSD: row.cost,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    additiveReasoningTokens: null,
    costPerCallUSD: null,
    pricingState: 'unknown' as const,
  }))
}
export function buildModelEfficiencyEvidence(question: string, scope: AdvisorScope, data: MenubarPayload, rows: ModelReportRow[]): AdvisorEvidence {
  const filtered = rows.filter(row => !scope.model || row.model === scope.model)
    .filter(row => scope.provider === 'all' || row.provider === scope.provider || row.providerDisplayName.toLowerCase() === scope.provider.toLowerCase())
    .filter(row => row.model && finite(row.costUSD) && finite(row.calls))
  const canonicalRows: AdvisorModelEvidenceRow[] = filtered.length
    ? filtered.map(row => ({
        model: row.model,
        provider: row.provider,
        calls: row.calls,
        costUSD: row.costUSD,
        inputTokens: finite(row.inputTokens) ? row.inputTokens : null,
        outputTokens: finite(row.outputTokens) ? row.outputTokens : null,
        totalTokens: finite(row.totalTokens) ? row.totalTokens : null,
        cacheReadTokens: finite(row.cacheReadTokens) ? row.cacheReadTokens : null,
        cacheWriteTokens: finite(row.cacheWriteTokens) ? row.cacheWriteTokens : null,
        reasoningTokens: finite(row.reasoningTokens) ? row.reasoningTokens : null,
        additiveReasoningTokens: finite(row.additiveReasoningTokens) ? row.additiveReasoningTokens : null,
        costPerCallUSD: pricingState(row) === 'priced' && row.calls > 0 ? row.costUSD / row.calls : null,
        pricingState: pricingState(row),
      }))
    : fallbackModels(data, scope)
  canonicalRows.sort((a, b) => (a.costPerCallUSD ?? Number.POSITIVE_INFINITY) - (b.costPerCallUSD ?? Number.POSITIVE_INFINITY))
  const rowsLimited = canonicalRows.slice(0, 12)
  const modelCoverage: AdvisorCoverage = !rowsLimited.length
    ? { level: 'unavailable', state: 'UNAVAILABLE', label: 'Model detail unavailable', detail: 'No model rows were returned for this scope.' }
    : rowsLimited.some(row => row.pricingState !== 'priced')
      ? { level: 'partial', state: 'PARTIAL', label: 'Partial model coverage', detail: 'One or more rows lack complete pricing or route detail.' }
      : { level: 'high', label: 'Model rows available', detail: 'The selected scope returned canonical model usage rows.' }
  const coverage = reconciliationCoverage(data, modelCoverage)
  return {
    intent: 'model-efficiency',
    question,
    scope,
    refs: [{ id: 'models.report', label: filtered.length ? 'Canonical model usage report' : 'Canonical Overview model rollup', source: filtered.length ? 'models' : 'overview' }],
    coverage,
    assumptions: [
      'Efficiency is represented as observed cost per call; comparable work and outcome quality are not available here.',
      'Rows use canonical Metrora pricing/accounting output and are not recalculated from raw tokens.',
    ],
    unknown: [
      ...reconciliationUnknown(data),
      ...(rowsLimited.length > 1 ? ['Calls are not normalized for task complexity, output quality, or prompt size.'] : ['A multi-model comparison is unavailable in this scope.']),
      ...(coverage.level === 'high' ? [] : ['Some model pricing or attribution is incomplete.']),
    ],
    nextInvestigations: ['Compare these models inside the same Project and task mix.', 'Open detailed sessions to inspect retries and one-shot outcomes.'],
    modelEfficiency: { rows: rowsLimited, selectedModel: scope.model, comparableWorkWarning: rowsLimited.length > 1 },
    domainCoverage: buildDomainCoverage(data, [{ id: 'models.report', label: filtered.length ? 'Canonical model usage report' : 'Canonical Overview model rollup', source: filtered.length ? 'models' : 'overview' }], rowsLimited),
  }
}
function quotaWindow(window: QuotaProvider['windows'][number]): AdvisorQuotaWindow {
  const usedPercent = Math.round(clamp(window.usedFraction) * 100)
  return { id: window.id, label: window.label, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: window.resetsAt }
}
function quotaProvider(quota: QuotaProvider): AdvisorQuotaProvider {
  const observed = typeof quota.observedAt === 'string' && Number.isFinite(Date.parse(quota.observedAt))
  const freshFactual = quota.freshness === 'fresh' && quota.availability === 'available' && quota.connection === 'connected' && observed
  const staleFactual = quota.freshness === 'stale'
    && quota.availability === 'unavailable'
    && observed
    && (quota.connection === 'stale' || quota.connection === 'transientFailure')
  const factual = freshFactual || staleFactual
  return {
    provider: quota.provider,
    planLabel: factual ? quota.planLabel : null,
    availability: quota.availability,
    connection: quota.connection,
    freshness: quota.freshness,
    observedAt: quota.observedAt,
    windows: factual ? quota.windows.map(quotaWindow) : [],
    creditsUSD: factual && quota.credits ? quota.credits.balance : null,
  }
}
function quotaCoverage(providers: AdvisorQuotaProvider[]): AdvisorCoverage {
  if (!providers.length) return { level: 'unavailable', state: 'UNAVAILABLE', label: 'Provider quota unavailable', detail: 'No matching provider quota snapshot was returned.' }
  const hasFacts = (row: AdvisorQuotaProvider) => row.windows.length > 0 || row.planLabel !== null || row.creditsUSD !== null
  const factual = providers.filter(hasFacts)
  const fresh = factual.filter(row => row.freshness === 'fresh' && row.availability === 'available' && typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))).length
  const stale = factual.filter(row => row.freshness === 'stale' && typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))).length
  if (factual.length === providers.length && fresh === providers.length) return { level: 'high', label: 'Fresh provider-reported quota', detail: 'Every matching provider returned a fresh factual snapshot.' }
  if (fresh && stale) return { level: 'partial', state: 'PARTIAL', label: 'Mixed provider quota freshness', detail: 'Some matching providers are fresh while another is stale.' }
  if (stale) return { level: 'partial', state: 'STALE', label: 'Last provider snapshot is stale', detail: 'Values are retained from the last observation; the refresh did not produce a fresh provider response.' }
  if (fresh) return { level: 'partial', state: 'PARTIAL', label: 'Partial provider quota', detail: 'At least one matching provider returned facts, but coverage across the selected providers is incomplete.' }
  return { level: 'unavailable', state: 'UNAVAILABLE', label: 'Provider quota unavailable', detail: 'The provider did not return usable quota facts.' }
}
export function buildQuotaEvidence(question: string, scope: AdvisorScope, data: MenubarPayload | null, quota: QuotaProvider[]): AdvisorEvidence {
  const matching = scope.provider === 'all' ? quota : quota.filter(row => row.provider === scope.provider)
  const providers = matching.map(quotaProvider)
  const refs: AdvisorEvidenceRef[] = providers.map(row => ({ id: 'quota.' + row.provider, label: (row.provider === 'claude' ? 'Claude' : 'Codex') + ' provider quota snapshot', source: 'quota' }))
  if (data) refs.push({ id: 'overview.current', label: 'Metrora-measured usage context', source: 'overview' })
  const coverage = quotaCoverage(providers)
  return {
    intent: 'quota-capacity',
    question,
    scope,
    refs,
    coverage,
    assumptions: [
      'Quota percentages, reset timestamps, and credits are shown only when the provider reports them.',
      'A stale snapshot keeps its last observed values and is labeled stale; unavailable snapshots show no quota numbers.',
    ],
    unknown: [
      ...(data ? reconciliationUnknown(data) : []),
      ...(coverage.level === 'high' ? [] : ['A fresh provider quota response is unavailable for every matching provider.']),
      'Metrora usage and provider quota use different authorities and are not combined into a burn-rate forecast.',
    ],
    nextInvestigations: ['Refresh the provider connection if the snapshot is stale or unavailable.', 'Review Metrora usage separately in Spend before drawing capacity conclusions.'],
    quota: {
      providers,
      measuredSpendUSD: !scope.model && data && finite(data.current.cost) ? data.current.cost : null,
      measuredCalls: !scope.model && data && finite(data.current.calls) ? data.current.calls : null,
    },
    domainCoverage: buildDomainCoverage(data, refs, [], quota),
  }
}
export function buildUnknownEvidence(question: string, scope: AdvisorScope): AdvisorEvidence {
  return {
    intent: 'unknown',
    question,
    scope,
    refs: [],
    coverage: { level: 'unavailable', state: 'UNSUPPORTED', label: 'Question needs a supported category', detail: 'Advisor currently answers measured spend, observed cost per call, provider quota, and controlled Bench questions.' },
    assumptions: [],
    unknown: ['No deterministic Metrora evidence tool is mapped to this question yet.'],
    nextInvestigations: ['Ask about a spend change or cost driver.', 'Ask which model has the lowest observed cost per call.', 'Ask what provider quota remains or when it resets.', 'Ask how a controlled Bench run performed.'],
  }
}
