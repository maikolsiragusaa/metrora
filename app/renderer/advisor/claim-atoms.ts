import { formatAdvisorPercent, periodLabel } from './evidence'
import { contentMinimalEvidence, contentMinimalScope, sanitizeAdvisorDisplayText } from './privacy'
import { advisorCopyLanguage } from './turn-plan'
import type {
  AdvisorClaimKindV1,
  AdvisorClaimMetricV1,
  AdvisorEvidence,
  AdvisorJsonObject,
  AdvisorJsonValue,
  AdvisorScope,
  AdvisorSynthesisDraftV1,
  AdvisorVerifiedClaimAtomV1,
} from './types'

const CLAIM_KINDS: readonly AdvisorClaimKindV1[] = ['measured_total', 'observed_count', 'provider_quota_remaining', 'provider_quota_reset', 'model_identity', 'model_measured_cost', 'project_measured_cost', 'session_measured_cost', 'trend_direction', 'coverage_state', 'freshness_state', 'bench_score', 'bench_status', 'bench_comparability', 'bench_performance_throughput', 'bench_performance_latency', 'bench_performance_status', 'bench_performance_comparability']
const CLAIM_METRICS: readonly AdvisorClaimMetricV1[] = ['cost', 'cost_per_call', 'calls', 'sessions', 'tokens', 'remaining_percent', 'credits', 'reset', 'direction', 'coverage', 'freshness', 'score', 'status', 'comparability', 'throughput', 'latency']

type MinimalEvidence = AdvisorJsonObject

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function getPath(value: unknown, path: string): unknown {
  let cursor: unknown = value
  for (const key of path.split('.')) {
    if (Array.isArray(cursor)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(key)) return undefined
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index < 0 || index >= cursor.length) return undefined
      cursor = cursor[index]
      continue
    }
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

function equalFact(actual: unknown, expected: AdvisorJsonValue): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-9
  if (typeof actual === 'string' && typeof expected === 'string') return actual === expected
  return actual === expected
}

function sameScope(left: AdvisorScope, right: AdvisorScope): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}

function refExists(evidence: AdvisorEvidence, ref: string): boolean {
  return evidence.refs.some(item => item.id === ref)
}

function pathReferenceCandidates(path: string): readonly string[] {
  if (path === 'spend.measuredCostUSD' || path === 'spend.calls' || path === 'spend.sessions' || path === 'quota.measuredSpendUSD' || path === 'quota.measuredCalls') return ['overview.current', 'overview.modelAccounting']
  if (path.startsWith('spend.history.') || path.startsWith('spend.trend.')) return ['overview.history.daily']
  if (path.startsWith('spend.models.')) return ['overview.models', 'overview.modelAccounting']
  if (path.startsWith('spend.projects.')) return ['overview.projects']
  if (path.startsWith('spend.sessionsByCost.')) return ['overview.sessions']
  if (path.startsWith('modelEfficiency.')) return ['models.report']
  if (path.startsWith('quota.providers.')) return ['quota.claude', 'quota.codex']
  if (path.startsWith('bench.latest.')) return ['bench.latest']
  if (path.startsWith('bench.runs.')) return ['bench.history']
  if (path.startsWith('bench.comparison.')) return ['bench.comparison']
  if (path.startsWith('bench.performance.latest.')) return ['bench.performance.latest']
  if (path.startsWith('bench.performance.runs.')) return ['bench.performance.history']
  if (path.startsWith('bench.performance.comparison.')) return ['bench.performance.comparison']
  if (path === 'coverage.level' || path === 'coverage.state') return ['overview.current', 'overview.modelAccounting', 'models.report', 'quota.claude', 'quota.codex', 'bench.latest', 'bench.history', 'bench.comparison', 'bench.performance.latest', 'bench.performance.history', 'bench.performance.comparison']
  return []
}

function referenceForPath(evidence: AdvisorEvidence, path: string): string | null {
  const exact = pathReferenceCandidates(path).find(ref => refExists(evidence, ref))
  if (exact) return exact
  const sources = path.startsWith('quota.') ? ['quota'] : path.startsWith('modelEfficiency.') ? ['models', 'overview'] : path.startsWith('bench.') ? ['bench'] : path.startsWith('spend.history.') || path.startsWith('spend.trend.') ? ['history'] : ['overview']
  return evidence.refs.find(ref => sources.includes(ref.source))?.id ?? null
}

function referenceOwnsPath(evidence: AdvisorEvidence, ref: string, path: string): boolean {
  const exactCandidates = pathReferenceCandidates(path)
  if (exactCandidates.some(candidate => refExists(evidence, candidate))) return exactCandidates.includes(ref)
  const source = evidence.refs.find(item => item.id === ref)?.source
  if (!source) return false
  if (path.startsWith('quota.')) return source === 'quota'
  if (path.startsWith('modelEfficiency.')) return source === 'models' || source === 'overview'
  if (path.startsWith('bench.')) return source === 'bench'
  if (path.startsWith('spend.history.') || path.startsWith('spend.trend.')) return source === 'history'
  if (path === 'coverage.level' || path === 'coverage.state') return true
  return source === 'overview'
}

function atom(id: string, claimKind: AdvisorClaimKindV1, subject: string | null, metric: AdvisorClaimMetricV1 | null, value: AdvisorJsonValue, unit: string | null, evidence: AdvisorEvidence, evidencePath: string): AdvisorVerifiedClaimAtomV1 | null {
  if (!CLAIM_KINDS.includes(claimKind) || (metric !== null && !CLAIM_METRICS.includes(metric))) return null
  const evidenceRef = referenceForPath(evidence, evidencePath)
  if (!evidenceRef) return null
  return {
    contractVersion: 'advisor-verified-claim-atom-v1',
    schemaVersion: 1,
    id,
    claimKind,
    subject,
    metric,
    value,
    unit,
    operator: 'equals',
    evidenceRef,
    evidencePath,
    scope: contentMinimalScope(evidence.scope),
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function scoreDenominatorValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 64 ? value : null
}

function addDirectNumber(atoms: AdvisorVerifiedClaimAtomV1[], evidence: AdvisorEvidence, id: string, kind: AdvisorClaimKindV1, metric: AdvisorClaimMetricV1, value: unknown, path: string, unit: string | null, subject: string | null = null): void {
  const number = numberValue(value)
  const next = number === null ? null : atom(id, kind, subject, metric, number, unit, evidence, path)
  if (next) atoms.push(next)
}

function addDirectString(atoms: AdvisorVerifiedClaimAtomV1[], evidence: AdvisorEvidence, id: string, kind: AdvisorClaimKindV1, metric: AdvisorClaimMetricV1, value: unknown, path: string, subject: string | null = null): void {
  const string = stringValue(value)
  const next = string === null ? null : atom(id, kind, subject, metric, string, null, evidence, path)
  if (next) atoms.push(next)
}

function addDirectBoolean(atoms: AdvisorVerifiedClaimAtomV1[], evidence: AdvisorEvidence, id: string, kind: AdvisorClaimKindV1, metric: AdvisorClaimMetricV1, value: unknown, path: string): void {
  const next = typeof value === 'boolean' ? atom(id, kind, null, metric, value, null, evidence, path) : null
  if (next) atoms.push(next)
}

/**
 * Builds the only material factual vocabulary that Advisor can expose to a
 * model or render to a user. The source is the content-minimal projection so
 * the atom paths are exactly the paths the model can inspect.
 */
export function buildAdvisorVerifiedClaimAtoms(evidence: AdvisorEvidence): AdvisorVerifiedClaimAtomV1[] {
  const minimal = contentMinimalEvidence(evidence, { preserveEvidenceIds: true }) as MinimalEvidence
  const atoms: AdvisorVerifiedClaimAtomV1[] = []
  const spend = isRecord(minimal.spend) ? minimal.spend : null
  if (spend) {
    addDirectNumber(atoms, evidence, 'measured-total-cost', 'measured_total', 'cost', spend.measuredCostUSD, 'spend.measuredCostUSD', 'USD')
    addDirectNumber(atoms, evidence, 'observed-calls', 'observed_count', 'calls', spend.calls, 'spend.calls', 'calls')
    addDirectNumber(atoms, evidence, 'observed-sessions', 'observed_count', 'sessions', spend.sessions, 'spend.sessions', 'sessions')
    addDirectNumber(atoms, evidence, 'observed-input-tokens', 'observed_count', 'tokens', spend.inputTokens, 'spend.inputTokens', 'tokens')
    addDirectNumber(atoms, evidence, 'observed-output-tokens', 'observed_count', 'tokens', spend.outputTokens, 'spend.outputTokens', 'tokens')
    addDirectNumber(atoms, evidence, 'observed-cache-read-tokens', 'observed_count', 'tokens', spend.cacheReadTokens, 'spend.cacheReadTokens', 'tokens')
    if (Array.isArray(spend.models)) {
      spend.models.forEach((row, index) => {
        if (!isRecord(row)) return
        const name = stringValue(row.name)
        if (!name) return
        const prefix = 'spend.models.' + index
        const identity = atom('model-identity-' + index, 'model_identity', name, null, name, null, evidence, prefix + '.name')
        if (identity) atoms.push(identity)
        addDirectNumber(atoms, evidence, 'model-measured-cost-' + index, 'model_measured_cost', 'cost', row.costUSD, prefix + '.costUSD', 'USD', name)
        addDirectNumber(atoms, evidence, 'model-observed-calls-' + index, 'observed_count', 'calls', row.calls, prefix + '.calls', 'calls', name)
      })
    }
    if (Array.isArray(spend.projects)) {
      spend.projects.forEach((row, index) => {
        if (!isRecord(row)) return
        const name = stringValue(row.name)
        if (!name) return
        addDirectNumber(atoms, evidence, 'project-measured-cost-' + index, 'project_measured_cost', 'cost', row.costUSD, 'spend.projects.' + index + '.costUSD', 'USD', name)
        addDirectNumber(atoms, evidence, 'project-observed-calls-' + index, 'observed_count', 'calls', row.calls, 'spend.projects.' + index + '.calls', 'calls', name)
      })
    }
    if (Array.isArray(spend.sessionsByCost)) {
      spend.sessionsByCost.forEach((row, index) => {
        if (!isRecord(row)) return
        const name = stringValue(row.name)
        if (!name) return
        addDirectNumber(atoms, evidence, 'session-measured-cost-' + index, 'session_measured_cost', 'cost', row.costUSD, 'spend.sessionsByCost.' + index + '.costUSD', 'USD', name)
      })
    }
    if (isRecord(spend.trend)) addDirectString(atoms, evidence, 'spend-trend-direction', 'trend_direction', 'direction', spend.trend.direction, 'spend.trend.direction')
  }

  const modelEfficiency = isRecord(minimal.modelEfficiency) ? minimal.modelEfficiency : null
  if (modelEfficiency && Array.isArray(modelEfficiency.rows)) {
    modelEfficiency.rows.forEach((row, index) => {
      if (!isRecord(row)) return
      const name = stringValue(row.model)
      if (!name) return
      const prefix = 'modelEfficiency.rows.' + index
      const identity = atom('efficiency-model-identity-' + index, 'model_identity', name, null, name, null, evidence, prefix + '.model')
      if (identity) atoms.push(identity)
      addDirectNumber(atoms, evidence, 'model-cost-per-call-' + index, 'model_measured_cost', 'cost_per_call', row.costPerCallUSD, prefix + '.costPerCallUSD', 'USD', name)
      addDirectNumber(atoms, evidence, 'efficiency-observed-calls-' + index, 'observed_count', 'calls', row.calls, prefix + '.calls', 'calls', name)
    })
  }

  const quota = isRecord(minimal.quota) ? minimal.quota : null
  if (quota) {
    addDirectNumber(atoms, evidence, 'quota-measured-total-cost', 'measured_total', 'cost', quota.measuredSpendUSD, 'quota.measuredSpendUSD', 'USD')
    addDirectNumber(atoms, evidence, 'quota-observed-calls', 'observed_count', 'calls', quota.measuredCalls, 'quota.measuredCalls', 'calls')
    if (Array.isArray(quota.providers)) {
      quota.providers.forEach((provider, providerIndex) => {
        if (!isRecord(provider)) return
        const name = stringValue(provider.provider)
        if (!name) return
        addDirectString(atoms, evidence, 'quota-freshness-' + name, 'freshness_state', 'freshness', provider.freshness, 'quota.providers.' + providerIndex + '.freshness', name)
        if (!Array.isArray(provider.windows)) return
        provider.windows.forEach((window, windowIndex) => {
          if (!isRecord(window)) return
          const prefix = 'quota.providers.' + providerIndex + '.windows.' + windowIndex
          addDirectNumber(atoms, evidence, 'quota-remaining-' + name + '-' + windowIndex, 'provider_quota_remaining', 'remaining_percent', window.remainingPercent, prefix + '.remainingPercent', '%', name)
          addDirectString(atoms, evidence, 'quota-reset-' + name + '-' + windowIndex, 'provider_quota_reset', 'reset', window.resetsAt, prefix + '.resetsAt', name)
        })
        addDirectNumber(atoms, evidence, 'quota-credits-' + name, 'provider_quota_remaining', 'credits', provider.creditsUSD, 'quota.providers.' + providerIndex + '.creditsUSD', 'USD', name)
      })
    }
  }

  const coverage = isRecord(minimal.coverage) ? minimal.coverage : null
  if (coverage) addDirectString(atoms, evidence, 'coverage-state', 'coverage_state', 'coverage', coverage.level, 'coverage.level')

  const bench = isRecord(minimal.bench) ? minimal.bench : null
  const latest = bench && isRecord(bench.latest) ? bench.latest : null
  if (latest) {
    const aggregate = isRecord(latest.aggregate) ? latest.aggregate : null
    if (aggregate) {
      const scoreAtom = atom('bench-score', 'bench_score', null, 'score', aggregate.scoreValue, '%', evidence, 'bench.latest.aggregate.scoreValue')
      if (scoreAtom) {
        const denominator = scoreDenominatorValue(aggregate.scoreDenominator)
        if (denominator !== null) scoreAtom.scoreDenominator = denominator
        atoms.push(scoreAtom)
      }
    }
    addDirectString(atoms, evidence, 'bench-status', 'bench_status', 'status', latest.status, 'bench.latest.status')
  }
  const comparison = bench && isRecord(bench.comparison) ? bench.comparison : null
  if (comparison) addDirectString(atoms, evidence, 'bench-comparability', 'bench_comparability', 'comparability', comparison.compatibility, 'bench.comparison.compatibility')
  const performance = bench && isRecord(bench.performance) ? bench.performance : null
  const performanceLatest = performance && isRecord(performance.latest) ? performance.latest : null
  if (performanceLatest && Array.isArray(performanceLatest.workloads)) {
    performanceLatest.workloads.forEach((workload, index) => {
      if (!isRecord(workload)) return
      const subject = stringValue(workload.workload)
      if (!subject || subject === 'unknown') return
      const prefix = 'bench.performance.latest.workloads.' + index
      addDirectNumber(atoms, evidence, 'bench-performance-throughput-' + subject, 'bench_performance_throughput', 'throughput', workload.throughputTokensPerSecond, prefix + '.throughputTokensPerSecond', 'tokens/s', subject)
      addDirectNumber(atoms, evidence, 'bench-performance-latency-' + subject, 'bench_performance_latency', 'latency', workload.averageLatencyMs, prefix + '.averageLatencyMs', 'ms', subject)
    })
    addDirectString(atoms, evidence, 'bench-performance-status', 'bench_performance_status', 'status', performanceLatest.status, 'bench.performance.latest.status')
  }
  const performanceComparison = performance && isRecord(performance.comparison) ? performance.comparison : null
  if (performanceComparison) addDirectBoolean(atoms, evidence, 'bench-performance-comparability', 'bench_performance_comparability', 'comparability', performanceComparison.compatible, 'bench.performance.comparison.compatible')
  return atoms
}

function pathMatches(kind: AdvisorClaimKindV1, metric: AdvisorClaimMetricV1 | null, path: string): boolean {
  if (kind === 'measured_total') return metric === 'cost' && /^(?:spend\.measuredCostUSD|quota\.measuredSpendUSD)$/u.test(path)
  if (kind === 'observed_count') return (metric === 'calls' && /^(?:spend\.calls|quota\.measuredCalls|spend\.(?:models|projects)\.\d+\.calls|spend\.sessionsByCost\.\d+\.calls|modelEfficiency\.rows\.\d+\.calls)$/u.test(path)) || (metric === 'sessions' && path === 'spend.sessions') || (metric === 'tokens' && /^spend\.(?:inputTokens|outputTokens|cacheReadTokens|cacheWriteTokens)$/u.test(path))
  if (kind === 'provider_quota_remaining') return (metric === 'remaining_percent' && /^quota\.providers\.\d+\.windows\.\d+\.remainingPercent$/u.test(path)) || (metric === 'credits' && /^quota\.providers\.\d+\.creditsUSD$/u.test(path))
  if (kind === 'provider_quota_reset') return metric === 'reset' && /^quota\.providers\.\d+\.windows\.\d+\.resetsAt$/u.test(path)
  if (kind === 'model_identity') return metric === null && /^(?:spend\.models\.\d+\.name|modelEfficiency\.rows\.\d+\.model)$/u.test(path)
  if (kind === 'model_measured_cost') return (metric === 'cost' && /^spend\.models\.\d+\.costUSD$/u.test(path)) || (metric === 'cost_per_call' && /^modelEfficiency\.rows\.\d+\.costPerCallUSD$/u.test(path))
  if (kind === 'project_measured_cost') return metric === 'cost' && /^spend\.projects\.\d+\.costUSD$/u.test(path)
  if (kind === 'session_measured_cost') return metric === 'cost' && /^spend\.sessionsByCost\.\d+\.costUSD$/u.test(path)
  if (kind === 'trend_direction') return metric === 'direction' && path === 'spend.trend.direction'
  if (kind === 'coverage_state') return metric === 'coverage' && path === 'coverage.level'
  if (kind === 'freshness_state') return metric === 'freshness' && /^quota\.providers\.\d+\.freshness$/u.test(path)
  if (kind === 'bench_score') return metric === 'score' && path === 'bench.latest.aggregate.scoreValue'
  if (kind === 'bench_status') return metric === 'status' && path === 'bench.latest.status'
  if (kind === 'bench_comparability') return metric === 'comparability' && path === 'bench.comparison.compatibility'
  if (kind === 'bench_performance_throughput') return metric === 'throughput' && /^bench\.performance\.latest\.workloads\.\d+\.throughputTokensPerSecond$/u.test(path)
  if (kind === 'bench_performance_latency') return metric === 'latency' && /^bench\.performance\.latest\.workloads\.\d+\.averageLatencyMs$/u.test(path)
  if (kind === 'bench_performance_status') return metric === 'status' && path === 'bench.performance.latest.status'
  if (kind === 'bench_performance_comparability') return metric === 'comparability' && path === 'bench.performance.comparison.compatible'
  return false
}

function subjectMatches(atomValue: AdvisorVerifiedClaimAtomV1, minimal: MinimalEvidence): boolean {
  if (atomValue.subject === null) return true
  const performanceMatch = atomValue.evidencePath.match(/^bench\.performance\.latest\.workloads\.(\d+)\.(?:workload|throughputTokensPerSecond|averageLatencyMs)$/u)
  if (performanceMatch) return equalFact(getPath(minimal, 'bench.performance.latest.workloads.' + performanceMatch[1] + '.workload'), atomValue.subject)
  const match = atomValue.evidencePath.match(/^(spend\.(?:models|projects|sessionsByCost)|modelEfficiency\.rows|quota\.providers)\.(\d+)/u)
  if (!match) return false
  const index = match[2]
  const prefix = match[1]
  const subjectPath = prefix === 'spend.models' ? 'spend.models.' + index + '.name'
    : prefix === 'spend.projects' ? 'spend.projects.' + index + '.name'
      : prefix === 'spend.sessionsByCost' ? 'spend.sessionsByCost.' + index + '.name'
        : prefix === 'modelEfficiency.rows' ? 'modelEfficiency.rows.' + index + '.model'
          : 'quota.providers.' + index + '.provider'
  return equalFact(getPath(minimal, subjectPath), atomValue.subject)
}

function unitMatches(atomValue: AdvisorVerifiedClaimAtomV1): boolean {
  if (atomValue.claimKind === 'measured_total' || atomValue.claimKind === 'model_measured_cost' || atomValue.claimKind === 'project_measured_cost' || atomValue.claimKind === 'session_measured_cost') return atomValue.unit === 'USD'
  if (atomValue.claimKind === 'provider_quota_remaining') return atomValue.metric === 'remaining_percent' ? atomValue.unit === '%' : atomValue.metric === 'credits' && atomValue.unit === 'USD'
  if (atomValue.claimKind === 'observed_count') return (atomValue.metric === 'calls' && atomValue.unit === 'calls') || (atomValue.metric === 'sessions' && atomValue.unit === 'sessions') || (atomValue.metric === 'tokens' && atomValue.unit === 'tokens')
  if (atomValue.claimKind === 'bench_score') return atomValue.unit === '%'
  if (atomValue.claimKind === 'bench_performance_throughput') return atomValue.unit === 'tokens/s'
  if (atomValue.claimKind === 'bench_performance_latency') return atomValue.unit === 'ms'
  return atomValue.unit === null
}

/**
 * Explicit semantic verification table. A value match alone is insufficient:
 * kind, metric, path shape, owning evidence reference, subject, scope, and
 * equality operator must all agree.
 */
export function verifyAdvisorVerifiedClaimAtom(atomValue: AdvisorVerifiedClaimAtomV1, evidence: AdvisorEvidence): boolean {
  if (atomValue.contractVersion !== 'advisor-verified-claim-atom-v1' || atomValue.schemaVersion !== 1 || atomValue.operator !== 'equals') return false
  if (!sameScope(atomValue.scope, contentMinimalScope(evidence.scope))) return false
  if (!refExists(evidence, atomValue.evidenceRef) || !referenceOwnsPath(evidence, atomValue.evidenceRef, atomValue.evidencePath)) return false
  if (!pathMatches(atomValue.claimKind, atomValue.metric, atomValue.evidencePath)) return false
  if (!unitMatches(atomValue)) return false
  const minimal = contentMinimalEvidence(evidence, { preserveEvidenceIds: true }) as MinimalEvidence
  if (!equalFact(getPath(minimal, atomValue.evidencePath), atomValue.value)) return false
  if (atomValue.scoreDenominator !== undefined) {
    if (atomValue.claimKind !== 'bench_score') return false
    const denominator = scoreDenominatorValue(getPath(minimal, 'bench.latest.aggregate.scoreDenominator'))
    if (denominator === null || denominator !== atomValue.scoreDenominator) return false
  }
  return subjectMatches(atomValue, minimal)
}

export type AdvisorModelVerifiedFact = {
  id: string
  category: string
  subject: string | null
  metric: AdvisorClaimMetricV1 | null
  value: AdvisorJsonValue
  unit: string | null
}

function modelFactCategory(kind: AdvisorClaimKindV1): string {
  const labels: Partial<Record<AdvisorClaimKindV1, string>> = {
    measured_total: 'measured total',
    observed_count: 'observed count',
    provider_quota_remaining: 'provider quota remaining',
    provider_quota_reset: 'provider quota reset',
    model_identity: 'observed model',
    model_measured_cost: 'measured model cost',
    project_measured_cost: 'measured Project cost',
    session_measured_cost: 'measured session cost',
    trend_direction: 'measured spend trend',
    coverage_state: 'evidence coverage',
    freshness_state: 'provider freshness',
    bench_score: 'controlled Bench score',
    bench_status: 'controlled Bench status',
    bench_comparability: 'controlled Bench comparability',
    bench_performance_throughput: 'measured Performance throughput',
    bench_performance_latency: 'measured Performance latency',
    bench_performance_status: 'native Performance status',
    bench_performance_comparability: 'native Performance comparability',
  }
  return labels[kind] ?? 'verified Metrora fact'
}

/** Model-facing fact choices omit contract, scope, path, and provenance internals. */
export function contentMinimalVerifiedClaimAtoms(evidence: AdvisorEvidence): AdvisorModelVerifiedFact[] {
  return buildAdvisorVerifiedClaimAtoms(evidence).map(atomValue => ({
    id: atomValue.id,
    category: modelFactCategory(atomValue.claimKind),
    subject: atomValue.subject === null ? null : sanitizeAdvisorDisplayText(atomValue.subject),
    metric: atomValue.metric,
    value: atomValue.value,
    unit: atomValue.unit === null ? null : sanitizeAdvisorDisplayText(atomValue.unit),
  }))
}

function integer(value: number, language: 'en' | 'it'): string {
  return value.toLocaleString(language === 'it' ? 'it-IT' : 'en-US')
}

function currency(value: number, language: 'en' | 'it'): string {
  return new Intl.NumberFormat(language === 'it' ? 'it-IT' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function percentPoints(value: number, language: 'en' | 'it'): string {
  return integer(value, language) + '%'
}

function dateText(value: string, language: 'en' | 'it'): string {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(language === 'it' ? 'it-IT' : 'en-US') : value
}

type PresentationLabel = { en: string; it: string }

const COVERAGE_LABELS: Record<string, PresentationLabel> = {
  high: { en: 'high', it: 'elevata' },
  partial: { en: 'partial', it: 'parziale' },
  unavailable: { en: 'unavailable', it: 'non disponibile' },
}

const FRESHNESS_LABELS: Record<string, PresentationLabel> = {
  fresh: { en: 'up to date', it: 'aggiornata' },
  stale: { en: 'not up to date (last known)', it: 'non aggiornata (ultimo dato noto)' },
  unavailable: { en: 'unavailable', it: 'non disponibile' },
}

const BENCH_STATUS_LABELS: Record<string, PresentationLabel> = {
  completed: { en: 'completed', it: 'completato' },
  unavailable: { en: 'unavailable', it: 'non disponibile' },
  cancelled: { en: 'cancelled', it: 'annullato' },
  failed: { en: 'failed', it: 'fallito' },
}

const BENCH_COMPARABILITY_LABELS: Record<string, PresentationLabel> = {
  compatible: { en: 'comparable', it: 'comparabile' },
  incompatible: { en: 'not comparable', it: 'non comparabile' },
}

function presentationLabel(value: string, labels: Record<string, PresentationLabel>, language: 'en' | 'it'): string | null {
  return labels[value]?.[language] ?? null
}

function providerDisplayName(value: string): string {
  if (value === 'codex') return 'Codex'
  if (value === 'claude') return 'Claude'
  return value
}

export function renderAdvisorVerifiedClaimAtom(atomValue: AdvisorVerifiedClaimAtomV1, language: 'en' | 'it'): string {
  const value = atomValue.value
  const subject = atomValue.subject ?? ''
  const provider = atomValue.subject === null ? 'provider' : providerDisplayName(atomValue.subject)
  if (atomValue.claimKind === 'measured_total' && atomValue.metric === 'cost' && typeof value === 'number') return language === 'it' ? 'Hai speso ' + currency(value, language) + ' nel periodo selezionato.' : 'Metrora measured ' + currency(value, language) + ' in the selected period.'
  if (atomValue.claimKind === 'observed_count' && typeof value === 'number') {
    const label = atomValue.metric === 'sessions' ? (language === 'it' ? 'sessioni' : 'sessions') : atomValue.metric === 'tokens' ? (language === 'it' ? 'token' : 'tokens') : (language === 'it' ? 'chiamate' : 'calls')
    return subject ? (language === 'it' ? 'Sono state registrate ' + integer(value, language) + ' ' + label + ' per ' + subject + '.' : 'Metrora recorded ' + integer(value, language) + ' ' + label + ' for ' + subject + '.') : (language === 'it' ? 'Metrora ha registrato ' + integer(value, language) + ' ' + label + ' nel periodo selezionato.' : 'Metrora recorded ' + integer(value, language) + ' ' + label + ' in the selected period.')
  }
  if (atomValue.claimKind === 'provider_quota_remaining' && atomValue.metric === 'credits' && typeof value === 'number') return language === 'it' ? 'Il credito residuo riportato da ' + provider + ' è ' + currency(value, language) + '.' : provider + ' provider credits remaining are ' + currency(value, language) + '.'
  if (atomValue.claimKind === 'provider_quota_remaining' && atomValue.metric === 'remaining_percent' && typeof value === 'number') return language === 'it' ? provider + ' riporta il ' + percentPoints(value, language) + ' di quota rimanente.' : provider + ' reports ' + percentPoints(value, language) + ' quota remaining.'
  if (atomValue.claimKind === 'provider_quota_reset' && typeof value === 'string') return language === 'it' ? 'Il reset della quota di ' + provider + ' è riportato alle ' + dateText(value, language) + '.' : provider + ' quota reset is reported at ' + dateText(value, language) + '.'
  if (atomValue.claimKind === 'model_identity' && typeof value === 'string') return language === 'it' ? 'Il modello osservato è ' + value + '.' : 'The observed model is ' + value + '.'
  if (atomValue.claimKind === 'model_measured_cost' && typeof value === 'number') return atomValue.metric === 'cost_per_call'
    ? (language === 'it' ? 'Il costo osservato per chiamata di ' + subject + ' è ' + currency(value, language) + '.' : 'Observed cost per call for ' + subject + ' was ' + currency(value, language) + '.')
    : (language === 'it' ? 'La spesa osservata di ' + subject + ' è ' + currency(value, language) + '.' : 'Observed spend for ' + subject + ' was ' + currency(value, language) + '.')
  if (atomValue.claimKind === 'project_measured_cost' && typeof value === 'number') return language === 'it' ? 'La spesa misurata del progetto ' + subject + ' è ' + currency(value, language) + '.' : 'Measured spend for Project ' + subject + ' was ' + currency(value, language) + '.'
  if (atomValue.claimKind === 'session_measured_cost' && typeof value === 'number') return language === 'it' ? 'La sessione ' + subject + ' ha registrato ' + currency(value, language) + '.' : 'Session ' + subject + ' recorded ' + currency(value, language) + '.'
  if (atomValue.claimKind === 'trend_direction' && typeof value === 'string') {
    const direction = value === 'up' ? (language === 'it' ? 'in aumento' : 'up') : value === 'down' ? (language === 'it' ? 'in diminuzione' : 'down') : (language === 'it' ? 'stabile' : 'flat')
    return language === 'it' ? 'L’andamento della spesa misurata è ' + direction + '.' : 'Measured spend trend was ' + direction + '.'
  }
  if (atomValue.claimKind === 'coverage_state' && typeof value === 'string') {
    const label = presentationLabel(value, COVERAGE_LABELS, language)
    if (label) return language === 'it' ? 'La copertura delle evidenze è ' + label + '.' : 'Evidence coverage is ' + label + '.'
  }
  if (atomValue.claimKind === 'freshness_state' && typeof value === 'string') {
    const label = presentationLabel(value, FRESHNESS_LABELS, language)
    if (label) return language === 'it' ? 'La freschezza della quota di ' + provider + ' è ' + label + '.' : provider + ' quota freshness is ' + label + '.'
  }
  if (atomValue.claimKind === 'bench_score' && typeof value === 'number') {
    const denominator = scoreDenominatorValue(atomValue.scoreDenominator)
    const context = denominator === null ? '' : language === 'it' ? ' su ' + integer(denominator, language) + ' controlli valutati' : ' of ' + integer(denominator, language) + ' scored checks'
    return language === 'it' ? 'Il punteggio dell’ultimo test controllato è ' + formatAdvisorPercent(value) + context + '.' : 'The latest controlled test score was ' + formatAdvisorPercent(value) + context + '.'
  }
  if (atomValue.claimKind === 'bench_status' && typeof value === 'string') {
    const label = presentationLabel(value, BENCH_STATUS_LABELS, language)
    if (label) return language === 'it' ? 'Lo stato dell’ultimo test controllato è ' + label + '.' : 'The latest controlled test status is ' + label + '.'
  }
  if (atomValue.claimKind === 'bench_comparability' && typeof value === 'string') {
    const label = presentationLabel(value, BENCH_COMPARABILITY_LABELS, language)
    if (label) return language === 'it' ? 'La comparabilità dei test controllati è ' + label + '.' : 'Controlled test comparability is ' + label + '.'
  }
  if (atomValue.claimKind === 'bench_performance_throughput' && typeof value === 'number') {
    const workload = subject || 'Performance'
    return language === 'it' ? 'Il throughput ' + workload + ' misurato è ' + value.toFixed(1) + ' token al secondo.' : 'Measured ' + workload + ' throughput was ' + value.toFixed(1) + ' tokens per second.'
  }
  if (atomValue.claimKind === 'bench_performance_latency' && typeof value === 'number') {
    const workload = subject || 'Performance'
    return language === 'it' ? 'Il tempo medio ' + workload + ' misurato è ' + value.toFixed(1) + ' millisecondi.' : 'Measured average ' + workload + ' time was ' + value.toFixed(1) + ' milliseconds.'
  }
  if (atomValue.claimKind === 'bench_performance_status' && typeof value === 'string') {
    const label = presentationLabel(value, BENCH_STATUS_LABELS, language)
    if (label) return language === 'it' ? 'Lo stato dell’ultima Performance nativa è ' + label + '.' : 'The latest native Performance status is ' + label + '.'
  }
  if (atomValue.claimKind === 'bench_performance_comparability' && typeof value === 'boolean') {
    const label = value ? (language === 'it' ? 'comparabile' : 'comparable') : (language === 'it' ? 'non comparabile' : 'not comparable')
    return language === 'it' ? 'La comparabilità delle Performance è ' + label + '.' : 'Performance comparability is ' + label + '.'
  }
  return language === 'it' ? 'Questa evidenza Metrora è disponibile.' : 'This Metrora evidence is available.'
}

function renderBlock(block: { claimIds: string[] }, atoms: Map<string, AdvisorVerifiedClaimAtomV1>, language: 'en' | 'it'): string {
  return block.claimIds.map(id => atoms.get(id)).filter((item): item is AdvisorVerifiedClaimAtomV1 => Boolean(item)).map(item => renderAdvisorVerifiedClaimAtom(item, language)).join(' ')
}

export function renderAdvisorVerifiedSynthesis(draft: AdvisorSynthesisDraftV1, atoms: AdvisorVerifiedClaimAtomV1[], question: string): { conclusion: string; why: string[]; details: string[] } {
  const language = advisorCopyLanguage(question)
  const atomMap = new Map(atoms.map(item => [item.id, item]))
  const narrative = draft.narrative
  const interpretation = narrative?.interpretation ?? null
  const recommendation = narrative?.recommendation ?? null
  const caveats = narrative?.caveats ?? []
  return {
    conclusion: [renderBlock(draft.conclusion, atomMap, language), interpretation, recommendation].filter(Boolean).join(' '),
    why: [...draft.why.map(block => renderBlock(block, atomMap, language)).filter(Boolean), ...caveats].filter(Boolean),
    details: draft.details.map(block => renderBlock(block, atomMap, language)).filter(Boolean),
  }
}

function claimsForIntent(evidence: AdvisorEvidence, atoms = buildAdvisorVerifiedClaimAtoms(evidence)): AdvisorVerifiedClaimAtomV1[] {
  const include = (predicate: (item: AdvisorVerifiedClaimAtomV1) => boolean, limit = 8) => atoms.filter(predicate).slice(0, limit)
  if (evidence.intent === 'spend-change') return [
    ...include(item => item.id === 'measured-total-cost' || item.id === 'observed-calls' || item.id === 'observed-sessions', 3),
    ...include(item => item.claimKind === 'model_measured_cost', 4),
    ...include(item => item.claimKind === 'trend_direction', 1),
  ]
  if (evidence.intent === 'model-efficiency') return include(item => item.claimKind === 'model_measured_cost' || item.claimKind === 'model_identity', 8)
  if (evidence.intent === 'quota-capacity') return include(item => item.claimKind === 'provider_quota_remaining' || item.claimKind === 'provider_quota_reset' || item.claimKind === 'freshness_state', 8)
  if (evidence.intent === 'bench-result') return include(item => item.claimKind.startsWith('bench_'), 4)
  return []
}

/** Deterministic/offline material answer path using the same verified atoms. */
export function renderDeterministicEvidenceAnswer(answer: import('./types').AdvisorAnswer, evidence: AdvisorEvidence, question: string): import('./types').AdvisorAnswer {
  const allAtoms = buildAdvisorVerifiedClaimAtoms(evidence)
  const verifiedAtoms = allAtoms.filter(atomValue => verifyAdvisorVerifiedClaimAtom(atomValue, evidence))
  const selected = claimsForIntent(evidence, verifiedAtoms)
  const language = advisorCopyLanguage(question)
  const rendered = selected.map(item => renderAdvisorVerifiedClaimAtom(item, language))
  const coverageAtom = verifiedAtoms.find(item => item.claimKind === 'coverage_state')
  const fallbackConclusion = coverageAtom ? renderAdvisorVerifiedClaimAtom(coverageAtom, language) : (language === 'it' ? 'Non sono disponibili evidenze Metrora sufficienti per questa domanda.' : 'There is not enough Metrora evidence for this question yet.')
  const conclusion = rendered[0] ?? fallbackConclusion
  const why = rendered.slice(1, evidence.intent === 'spend-change' ? 3 : 2)
  const details = rendered.slice(1)
  return {
    ...answer,
    conclusion,
    why,
    details,
    claims: verifiedAtoms,
    materialLimits: answer.materialLimits,
    periodLabel: periodLabel(evidence.scope),
  }
}
