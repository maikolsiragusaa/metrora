/**
 * Transport-neutral factual Tools contracts.
 *
 * This module deliberately has no renderer, Electron, provider adapter, or
 * MCP dependency. Adapters may map their source snapshots into these narrow
 * structural types; the registry remains the single factual implementation.
 */

export type MetroraToolPeriod = 'today' | 'week' | '30days' | 'month' | 'all' | 'lifetime'
export type MetroraToolPeriodFilter = MetroraToolPeriod | 'yesterday'
export type MetroraToolDateRange = { from: string; to: string }
export type MetroraToolScope = {
  period: MetroraToolPeriod
  range: MetroraToolDateRange | null
  provider: string
  projectId: string
  projectName: string
  model: string | null
}
export type MetroraToolScopeIdentity = Pick<MetroraToolScope, 'period' | 'range' | 'provider' | 'projectId' | 'model'>
export type MetroraOverviewSnapshot = {
  /** Exact scope provenance for the payload; never infer this from freshness. */
  scopeFingerprint: string
  payload: MetroraOverview
}
export type MetroraToolScopeOptions = { allowedPeriods?: readonly MetroraToolPeriodFilter[] }

export function metroraToolScopeFingerprint(scope: MetroraToolScope): string {
  return JSON.stringify({
    period: scope.period,
    range: scope.range ? { from: scope.range.from, to: scope.range.to } : null,
    provider: scope.provider,
    projectId: scope.projectId,
    projectName: scope.projectName,
    model: scope.model,
  })
}

export type MetroraToolJsonValue = null | string | number | boolean | { [key: string]: MetroraToolJsonValue } | MetroraToolJsonValue[]
export type MetroraToolJsonObject = { [key: string]: MetroraToolJsonValue }

export type MetroraToolName =
  | 'get_spend_snapshot'
  | 'get_model_efficiency'
  | 'get_quota_snapshot'
  | 'get_overview_snapshot'
  | 'get_project_drivers'
  | 'get_session_highlights'
  | 'get_coverage_report'
  | 'get_bench_evidence'
export type MetroraToolArgumentName = 'model' | 'provider' | 'period'

export type MetroraToolDefinition = {
  type: 'function'
  function: { name: MetroraToolName; description: string; parameters: Record<string, unknown> }
}

export type MetroraToolEvidenceState = 'NO_DATA' | 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL' | 'STALE' | 'NOT_COMPARABLE' | 'UNSUPPORTED' | 'RUNTIME_UNAVAILABLE'
export type MetroraToolCoverageLevel = 'high' | 'partial' | 'unavailable'
export type MetroraToolCoverage = { level: MetroraToolCoverageLevel; label: string; detail: string; state?: MetroraToolEvidenceState }
export type MetroraToolEvidenceSource = 'overview' | 'history' | 'models' | 'quota' | 'bench'
export type MetroraToolEvidenceRef = { id: string; label: string; source: MetroraToolEvidenceSource }
export type MetroraToolDomain = 'usage-totals' | 'usage-time-series' | 'cost' | 'tokens' | 'cache' | 'reasoning' | 'models' | 'providers' | 'projects' | 'sessions' | 'pricing' | 'freshness' | 'provider-capacity' | 'bench-history'
export type MetroraToolDomainCoverage = { domain: MetroraToolDomain; state: 'available' | 'partial' | 'unavailable' | 'not-authorized'; detail: string; evidenceRefs: MetroraToolEvidenceRef[] }
export type MetroraToolAuthority = 'metrora-canonical' | 'provider-reported' | 'mixed' | 'unknown'
export type MetroraToolFreshness = 'fresh' | 'stale' | 'mixed' | 'unavailable' | 'unknown'
export type MetroraToolEvidenceValueStatus = 'observed' | 'derived' | 'estimated' | 'unknown'
export type MetroraToolEvidenceSemantics = { source: MetroraToolEvidenceSource | 'unknown'; authority: MetroraToolAuthority; status: MetroraToolEvidenceValueStatus }

export type MetroraToolSpendDriver = { name: string; costUSD: number; calls: number }
export type MetroraToolTrend = { direction: 'up' | 'down' | 'flat'; latestCostUSD: number; comparisonCostUSD: number; deltaUSD: number; deltaPercent: number | null; latestDate: string; comparisonLabel: string }
export type MetroraToolUsagePoint = { date: string; costUSD: number | null; calls: number | null; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }
export type MetroraToolModelUsageSeries = { model: string; points: Array<{ date: string; costUSD: number | null; calls: number | null }> }
export type MetroraToolSpendEvidence = {
  measuredCostUSD: number | null
  calls: number | null
  sessions: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  models: MetroraToolSpendDriver[]
  projects: MetroraToolSpendDriver[]
  sessionsByCost: MetroraToolSpendDriver[]
  trend: MetroraToolTrend | null
  pricingCoverage: number | null
  history: MetroraToolUsagePoint[]
  modelHistory: MetroraToolModelUsageSeries[]
}
export type MetroraToolModelEvidenceRow = {
  model: string
  provider: string
  calls: number
  costUSD: number
  inputTokens?: number | null
  outputTokens: number | null
  totalTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
  additiveReasoningTokens?: number | null
  costPerCallUSD: number | null
  pricingState: 'priced' | 'partial' | 'unavailable' | 'unknown'
}
export type MetroraToolModelEvidence = { rows: MetroraToolModelEvidenceRow[]; selectedModel: string | null; comparableWorkWarning: boolean }
export type MetroraToolQuotaWindow = { id: string; label: string; usedPercent: number; remainingPercent: number; resetsAt: string | null }
export type MetroraToolQuotaProvider = {
  provider: string
  planLabel: string | null
  availability: string
  connection: string
  freshness: string
  observedAt: string | null
  windows: MetroraToolQuotaWindow[]
  creditsUSD: number | null
}
export type MetroraToolQuotaEvidence = { providers: MetroraToolQuotaProvider[]; measuredSpendUSD: number | null; measuredCalls: number | null }

export type MetroraToolBenchEvidence = MetroraToolJsonObject & { state?: MetroraToolEvidenceState }
export type MetroraToolEvidence = {
  intent: 'spend-change' | 'model-efficiency' | 'quota-capacity' | 'bench-result' | 'unknown'
  question: string
  scope: MetroraToolScope
  refs: MetroraToolEvidenceRef[]
  coverage: MetroraToolCoverage
  assumptions: string[]
  unknown: string[]
  nextInvestigations: string[]
  domainCoverage?: MetroraToolDomainCoverage[]
  spend?: MetroraToolSpendEvidence
  modelEfficiency?: MetroraToolModelEvidence
  quota?: MetroraToolQuotaEvidence
  bench?: MetroraToolBenchEvidence
}

export type MetroraOverviewHistoryDay = {
  date: string
  cost?: number
  calls?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  topModels?: Array<{ name: string; cost?: number; calls?: number }>
}
export type MetroraOverviewModelAccountingRow = {
  name: string
  cost?: number
  calls?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  additiveReasoningTokens?: number
}
export type MetroraOverview = {
  generated?: string
  freshness?: { readMode?: string; reconciliation?: string; durableThrough?: string | null }
  current?: {
    label?: string
    cost?: number
    calls?: number
    sessions?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    pricingCoverage?: number | null
    providers?: Record<string, number>
    providerDetails?: Array<{ id: string; label: string; cost: number }>
    topModels?: Array<{ name: string; cost?: number; calls?: number }>
    topProjects?: Array<{ name: string; cost?: number; sessions?: number }>
    topSessions?: Array<{ project?: string; cost?: number; calls?: number; date?: string }>
    modelAccounting?: { rows?: MetroraOverviewModelAccountingRow[]; coverage?: { cost?: number | null } }
  }
  history?: { daily?: MetroraOverviewHistoryDay[] }
}

export type MetroraModelReportRow = {
  provider?: string
  providerDisplayName?: string
  model: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  additiveReasoningTokens?: number
  cacheWriteTokens?: number
  cacheReadTokens?: number
  totalTokens?: number
  costUSD?: number
  calls?: number
  pricing?: { state?: string }
}
export type MetroraQuotaSnapshot = {
  provider: string
  availability?: string
  connection?: string
  freshness?: string
  observedAt?: string | null
  planLabel?: string | null
  windows?: Array<{ id: string; label: string; usedFraction?: number; resetsAt?: string | null }>
  credits?: { balance?: number | null }
}

export type MetroraToolDataSource = {
  getOverview(context: MetroraToolScope, signal?: AbortSignal): Promise<MetroraOverview>
  getModels(context: MetroraToolScope, signal?: AbortSignal): Promise<MetroraModelReportRow[]>
  getQuota(signal?: AbortSignal): Promise<MetroraQuotaSnapshot[]>
  getBenchEvidence?(context: MetroraToolScope, signal?: AbortSignal): Promise<MetroraToolBenchEvidence>
}
export type MetroraToolExecution = { content: string; evidence: MetroraToolEvidence; envelope?: MetroraToolResultEnvelope }
export type MetroraToolExecutor = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<MetroraToolExecution>
export type MetroraToolInvocation = { contractVersion: string; tool: MetroraToolName; scope: MetroraToolScope; arguments: MetroraToolJsonObject }
export type MetroraToolResultEnvelope = {
  contractVersion: string
  schemaVersion: 1
  tool: MetroraToolName
  scope: MetroraToolScope
  arguments: MetroraToolJsonObject
  authority: MetroraToolAuthority
  freshness: MetroraToolFreshness
  coverage: MetroraToolCoverage
  semantics: MetroraToolEvidenceSemantics[]
  evidenceRefs: MetroraToolEvidenceRef[]
  unavailable: boolean
  privacy: 'content-minimal'
  output: MetroraToolJsonObject
}
export type MetroraToolContract = {
  contractVersion: string
  schemaVersion: 1
  tools: readonly MetroraToolDefinition[]
  scope: { immutable: true; dimensions: readonly string[]; allowedFilters: Readonly<Record<MetroraToolName, readonly MetroraToolArgumentName[]>> }
  output: { maxBytes: number; privacy: 'content-minimal'; jsonSafe: true }
}
export type MetroraToolRegistry = { contract: MetroraToolContract; definitions: readonly MetroraToolDefinition[]; scope: MetroraToolScope; execute: MetroraToolExecutor }
