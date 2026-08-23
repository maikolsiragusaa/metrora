import { formatUsd } from '../lib/format'
import type { MenubarPayload, ModelReportRow, Period, QuotaProvider } from '../lib/types'
import type {
  AdvisorCoverage,
  AdvisorEvidence,
  AdvisorEvidenceRef,
  AdvisorIntent,
  AdvisorModelEvidenceRow,
  AdvisorQuotaProvider,
  AdvisorQuotaWindow,
  AdvisorScope,
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
  if (/(quota|capacity|limit|reset|remaining|exhaust|rate.?limit|credit|disponibil|limite|esaur)/.test(value)) return 'quota-capacity'
  if (/(model|efficient|efficien|cheaper|cheap|expensive|cost per|per call|retry|retries|econom|modello)/.test(value)) return 'model-efficiency'
  if (/(spend|cost|spent|increase|increas|change|changed|spike|driver|cause|why|costo|spesa|aument|picco|perche|perché)/.test(value)) return 'spend-change'
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
  const hasCalls = finite(data.current.calls) && data.current.calls > 0
  const hasCost = finite(data.current.cost) && data.current.cost > 0
  if (!hasCalls && !hasCost) return { level: 'unavailable', label: 'No measured usage', detail: 'The selected scope has no measured spend or calls.' }
  const coverage = finite(data.current.pricingCoverage)
    ? clamp(data.current.pricingCoverage)
    : data.current.modelAccounting && finite(data.current.modelAccounting.coverage.cost)
      ? clamp(data.current.modelAccounting.coverage.cost)
      : null
  if (coverage === null) return { level: 'partial', label: 'Measured, coverage not reported', detail: 'Metrora reported totals, but complete pricing/accounting coverage is not exposed.' }
  return coverage >= 0.95
    ? { level: 'high', label: formatAdvisorPercent(coverage) + ' priced coverage', detail: 'The canonical payload reports near-complete pricing coverage.' }
    : { level: 'partial', label: formatAdvisorPercent(coverage) + ' priced coverage', detail: 'Some cost-bearing calls lack complete pricing/accounting detail.' }
}
function reconciliationCoverage(data: MenubarPayload, coverage: AdvisorCoverage): AdvisorCoverage {
  const state = data.freshness?.reconciliation
  if ((state !== 'degraded' && state !== 'targeted') || coverage.level !== 'high') return coverage
  return {
    level: 'partial',
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
      models,
      projects,
      sessionsByCost: sessions,
      trend,
      pricingCoverage: modelScoped ? null : finite(data.current.pricingCoverage) ? clamp(data.current.pricingCoverage) : null,
    },
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
    outputTokens: null,
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
        outputTokens: finite(row.outputTokens) ? row.outputTokens : null,
        costPerCallUSD: pricingState(row) === 'priced' && row.calls > 0 ? row.costUSD / row.calls : null,
        pricingState: pricingState(row),
      }))
    : fallbackModels(data, scope)
  canonicalRows.sort((a, b) => (a.costPerCallUSD ?? Number.POSITIVE_INFINITY) - (b.costPerCallUSD ?? Number.POSITIVE_INFINITY))
  const rowsLimited = canonicalRows.slice(0, 12)
  const modelCoverage: AdvisorCoverage = !rowsLimited.length
    ? { level: 'unavailable', label: 'Model detail unavailable', detail: 'No model rows were returned for this scope.' }
    : rowsLimited.some(row => row.pricingState !== 'priced')
      ? { level: 'partial', label: 'Partial model coverage', detail: 'One or more rows lack complete pricing or route detail.' }
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
  if (!providers.length) return { level: 'unavailable', label: 'Provider quota unavailable', detail: 'No matching provider quota snapshot was returned.' }
  const hasFacts = (row: AdvisorQuotaProvider) => row.windows.length > 0 || row.planLabel !== null || row.creditsUSD !== null
  const factual = providers.filter(hasFacts)
  const fresh = factual.filter(row => row.freshness === 'fresh' && row.availability === 'available' && typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))).length
  const stale = factual.filter(row => row.freshness === 'stale' && typeof row.observedAt === 'string' && Number.isFinite(Date.parse(row.observedAt))).length
  if (factual.length === providers.length && fresh === providers.length) return { level: 'high', label: 'Fresh provider-reported quota', detail: 'Every matching provider returned a fresh factual snapshot.' }
  if (fresh || stale) return { level: 'partial', label: fresh ? 'Mixed provider quota freshness' : 'Last provider snapshot is stale', detail: fresh ? 'Some matching providers are fresh while another is stale or unavailable.' : 'Values are retained from the last observation; the refresh did not produce a fresh provider response.' }
  return { level: 'unavailable', label: 'Provider quota unavailable', detail: 'The provider did not return usable quota facts.' }
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
  }
}
export function buildUnknownEvidence(question: string, scope: AdvisorScope): AdvisorEvidence {
  return {
    intent: 'unknown',
    question,
    scope,
    refs: [],
    coverage: { level: 'unavailable', label: 'Question outside this foundation', detail: 'Advisor currently answers spend, model efficiency, and provider quota questions.' },
    assumptions: [],
    unknown: ['No deterministic Metrora evidence tool is mapped to this question yet.'],
    nextInvestigations: ['Ask about a spend change or cost driver.', 'Ask which model has the lowest observed cost per call.', 'Ask what provider quota remains or when it resets.'],
  }
}
