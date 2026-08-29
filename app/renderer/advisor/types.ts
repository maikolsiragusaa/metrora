import type { MetroraBridge } from '../lib/metrora-bridge-types'
import type { DateRange, MenubarPayload, ModelReportRow, Period, QuotaProvider } from '../lib/types'

export type AdvisorIntent =
  | 'social'
  | 'spend-change'
  | 'model-efficiency'
  | 'quota-capacity'
  | 'bench-result'
  | 'action-proposal'
  | 'clarification'
  | 'unsupported'
  | 'unknown'

export type AdvisorTurnKind = 'social' | 'investigate' | 'clarify' | 'boundary'
export type AdvisorQuestionFamily = 'usage' | 'spend' | 'tokens' | 'cache' | 'reasoning' | 'models' | 'providers' | 'projects' | 'sessions' | 'pricing' | 'quota' | 'bench' | 'evidence' | 'action' | 'unknown'
export type AdvisorScopeIntent = 'current' | 'explicit' | 'follow-up' | 'ambiguous'
export type AdvisorPresentationIntent = 'text' | 'metric-cards' | 'line-chart' | 'bar-chart' | 'comparison-table' | 'quota-card' | 'bench-summary' | 'warning' | 'evidence-disclosure'
export type AdvisorEvidenceDomain = 'usage-totals' | 'usage-time-series' | 'cost' | 'tokens' | 'cache' | 'reasoning' | 'models' | 'providers' | 'projects' | 'sessions' | 'pricing' | 'freshness' | 'provider-capacity' | 'bench-history'
export type AdvisorAuthorizationIntent = 'read-only' | 'proposal-required'
export type AdvisorTurnPlanV1 = {
  contractVersion: 'advisor-turn-plan-v1'
  schemaVersion: 1
  turnKind: AdvisorTurnKind
  questionFamily: AdvisorQuestionFamily
  scopeIntent: AdvisorScopeIntent
  requestedEvidenceDomains: readonly AdvisorEvidenceDomain[]
  clarification: string | null
  presentationIntent: AdvisorPresentationIntent
  expertDetailRequested: boolean
  authorization: AdvisorAuthorizationIntent
}

export type AdvisorEvidenceState = 'NO_DATA' | 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL' | 'STALE' | 'NOT_COMPARABLE' | 'UNSUPPORTED' | 'RUNTIME_UNAVAILABLE'
export type AdvisorScope = { period: Period; range: DateRange | null; provider: string; projectId: string; projectName: string; model: string | null }
export type AdvisorScopeIdentity = Pick<AdvisorScope, 'period' | 'range' | 'projectId' | 'provider' | 'model'>
export function advisorScopeFingerprint(scope: AdvisorScopeIdentity): string {
  return JSON.stringify({
    period: scope.period,
    range: scope.range ? { from: scope.range.from, to: scope.range.to } : null,
    projectId: scope.projectId,
    provider: scope.provider,
    model: scope.model,
  })
}
export type AdvisorCoverageLevel = 'high' | 'partial' | 'unavailable'
export type AdvisorCoverage = { level: AdvisorCoverageLevel; label: string; detail: string; state?: AdvisorEvidenceState }
export type AdvisorEvidenceSource = 'overview' | 'history' | 'models' | 'quota' | 'bench'
export type AdvisorEvidenceRef = { id: string; label: string; source: AdvisorEvidenceSource }
export type AdvisorJsonValue = null | string | number | boolean | { [key: string]: AdvisorJsonValue } | AdvisorJsonValue[]
export type AdvisorJsonObject = { [key: string]: AdvisorJsonValue }
export type AdvisorDomainCoverageState = 'available' | 'partial' | 'unavailable' | 'not-authorized'
export type AdvisorDomainCoverageV1 = { domain: AdvisorEvidenceDomain; state: AdvisorDomainCoverageState; detail: string; evidenceRefs: AdvisorEvidenceRef[] }
export type AdvisorToolName = 'get_spend_snapshot' | 'get_model_efficiency' | 'get_quota_snapshot' | 'get_overview_snapshot' | 'get_project_drivers' | 'get_session_highlights' | 'get_coverage_report' | 'get_bench_evidence'
export type AdvisorActionKindV1 = 'run-bench' | 'launch-agents' | 'change-routing' | 'apply-policy'
export type AdvisorActionProposalV1 = { contractVersion: 'advisor-action-proposal-v1'; schemaVersion: 1; kind: AdvisorActionKindV1; status: 'proposal-only'; summary: string; target: string; scope: AdvisorScope; allowedReadTools: readonly AdvisorToolName[]; permissions: readonly string[]; budget: { maxCalls: number; maxCostUSD: number | null }; timeoutMs: number; cancellation: 'required' }
export type AdvisorToolArgumentName = 'model' | 'provider' | 'period'
export type AdvisorToolAuthority = 'metrora-canonical' | 'provider-reported' | 'mixed' | 'unknown'
export type AdvisorToolFreshness = 'fresh' | 'stale' | 'mixed' | 'unavailable' | 'unknown'
export type AdvisorEvidenceValueStatus = 'observed' | 'derived' | 'estimated' | 'unknown'
export type AdvisorEvidenceSemantics = { source: AdvisorEvidenceSource | 'unknown'; authority: AdvisorToolAuthority; status: AdvisorEvidenceValueStatus }
export const ADVISOR_TOOL_CONTRACT_VERSION = 'advisor-tool-v1' as const
export const ADVISOR_TOOL_SCHEMA_VERSION = 1 as const
export type AdvisorSpendDriver = { name: string; costUSD: number; calls: number }
export type AdvisorTrend = { direction: 'up' | 'down' | 'flat'; latestCostUSD: number; comparisonCostUSD: number; deltaUSD: number; deltaPercent: number | null; latestDate: string; comparisonLabel: string }
export type AdvisorUsagePoint = { date: string; costUSD: number | null; calls: number | null; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }
export type AdvisorModelUsageSeries = { model: string; points: Array<{ date: string; costUSD: number | null; calls: number | null }> }
export type AdvisorSpendEvidence = { measuredCostUSD: number | null; calls: number | null; sessions: number | null; inputTokens?: number | null; outputTokens?: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null; models: AdvisorSpendDriver[]; projects: AdvisorSpendDriver[]; sessionsByCost: AdvisorSpendDriver[]; trend: AdvisorTrend | null; pricingCoverage: number | null; history: AdvisorUsagePoint[]; modelHistory: AdvisorModelUsageSeries[] }
export type AdvisorModelEvidenceRow = { model: string; provider: string; calls: number; costUSD: number; inputTokens?: number | null; outputTokens: number | null; totalTokens?: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null; reasoningTokens?: number | null; additiveReasoningTokens?: number | null; costPerCallUSD: number | null; pricingState: 'priced' | 'partial' | 'unavailable' | 'unknown' }
export type AdvisorModelEvidence = { rows: AdvisorModelEvidenceRow[]; selectedModel: string | null; comparableWorkWarning: boolean }
export type AdvisorQuotaWindow = { id: string; label: string; usedPercent: number; remainingPercent: number; resetsAt: string | null }
export type AdvisorQuotaProvider = { provider: QuotaProvider['provider']; planLabel: string | null; availability: QuotaProvider['availability']; connection: QuotaProvider['connection']; freshness: QuotaProvider['freshness']; observedAt: string | null; windows: AdvisorQuotaWindow[]; creditsUSD: number | null }
export type AdvisorQuotaEvidence = { providers: AdvisorQuotaProvider[]; measuredSpendUSD: number | null; measuredCalls: number | null }
export type AdvisorBenchTask = { taskId: string; status: 'passed' | 'failed' | 'malformed' | 'unavailable' | 'timeout' | 'cancelled'; score: number | null; requestLatencyMs: number | null; timeToFirstContentMs: number | null }
export type AdvisorBenchRun = { runId: string; pack: { id: string; version: string; digest: string }; scorer: { id: string; version: string }; runner: { id: string; version: string }; runtime: { id: string; version: string }; model: { selected: string; reported: string | null }; generationPolicy: string; status: 'completed' | 'unavailable' | 'cancelled'; aggregate: { planned: number; attempted: number; passed: number; failed: number; unavailable: number; cancelled: number; scoreNumerator: number | null; scoreDenominator: number | null; scoreValue: number | null }; tasks: AdvisorBenchTask[]; resultDigest: string }
export type AdvisorBenchComparison = { compatibility: 'compatible' | 'incompatible'; reason: 'compatible' | 'pack-mismatch' | 'runner-mismatch' | 'scoring-mismatch' | 'generation-mismatch' | 'missing-run'; comparedRunIds: string[]; scoreDelta: number | null; passedDelta: number | null; failedDelta: number | null; unavailableDelta: number | null; cancelledDelta: number | null; medianLatencyDeltaMs: number | null; timeToFirstContentDeltaMs: number | null }
export type AdvisorBenchEvidence = { state: AdvisorEvidenceState; runs: AdvisorBenchRun[]; latest: AdvisorBenchRun | null; comparison: AdvisorBenchComparison | null }
export type AdvisorQuestionUnderstanding = { intent: AdvisorIntent; summary: string; usedDefaultScope: boolean; clarification: string | null; boundary: string | null }
export type AdvisorGuardPlanV1 = {
  contractVersion: 'advisor-guard-plan-v1'
  schemaVersion: 1
  turnKind: AdvisorTurnKind
  scopeIntent: AdvisorScopeIntent
  clarification: string | null
  authorization: AdvisorAuthorizationIntent
  intent: AdvisorIntent
  usedDefaultScope: boolean
}
export type AdvisorClaimKindV1 = 'measured_total' | 'observed_count' | 'provider_quota_remaining' | 'provider_quota_reset' | 'model_identity' | 'model_measured_cost' | 'project_measured_cost' | 'session_measured_cost' | 'trend_direction' | 'coverage_state' | 'freshness_state' | 'bench_score' | 'bench_status' | 'bench_comparability'
export type AdvisorClaimMetricV1 = 'cost' | 'cost_per_call' | 'calls' | 'sessions' | 'tokens' | 'remaining_percent' | 'credits' | 'reset' | 'direction' | 'coverage' | 'freshness' | 'score' | 'status' | 'comparability'
export type AdvisorClaimOperatorV1 = 'equals'
export type AdvisorVerifiedClaimAtomV1 = {
  contractVersion: 'advisor-verified-claim-atom-v1'
  schemaVersion: 1
  id: string
  claimKind: AdvisorClaimKindV1
  subject: string | null
  metric: AdvisorClaimMetricV1 | null
  value: AdvisorJsonValue
  unit: string | null
  operator: AdvisorClaimOperatorV1
  evidenceRef: string
  evidencePath: string
  scope: AdvisorScope
  /** Denominator context for a bounded Bench score; absent for other claims. */
  scoreDenominator?: number
}
export type AdvisorClaimSelectionV1 = { contractVersion: 'advisor-claim-selection-v1'; schemaVersion: 1; id: string }
export type AdvisorSynthesisBlockV1 = { claimIds: string[]; emphasis?: 'primary' | 'supporting' | 'detail' }
export type AdvisorPresentationRequestV1 = { kind: AdvisorPresentationIntent; title?: string; evidenceRefs?: string[] }
export type AdvisorSynthesisDraftV1 = { contractVersion: 'advisor-synthesis-draft-v1'; schemaVersion: 1; conclusion: AdvisorSynthesisBlockV1; why: AdvisorSynthesisBlockV1[]; details: AdvisorSynthesisBlockV1[]; claims: AdvisorClaimSelectionV1[]; presentationRequests: AdvisorPresentationRequestV1[]; expertDetail?: string[] }
export type AdvisorToolRequestV1 = { tool: AdvisorToolName; arguments: AdvisorJsonObject }
export type AdvisorPlanningDraftV1 = {
  contractVersion: 'advisor-planning-draft-v1'
  schemaVersion: 1
  turnKind: 'investigate' | 'clarify'
  questionFamily: AdvisorQuestionFamily
  requestedEvidenceDomains: AdvisorEvidenceDomain[]
  toolRequests: AdvisorToolRequestV1[]
  presentationIntent: AdvisorPresentationIntent
  expertDetailRequested: boolean
  clarification: string | null
}
export type AdvisorPresentationMetricCard = { label: string; value: string; unit: string; detail: string; claimIds: string[] }
export type AdvisorPresentationTable = { columns: string[]; rows: string[][] }
export type AdvisorPresentationChartSeries = { id: string; label: string; points: Array<{ label: string; value: number | null }> }
export type AdvisorPresentationBlockV1 =
  | { kind: 'text'; text: string; claimIds: string[] }
  | { kind: 'metric-cards'; title: string; cards: AdvisorPresentationMetricCard[]; scopeLabel: string; periodLabel: string; evidenceRefs: AdvisorEvidenceRef[] }
  | { kind: 'line-chart' | 'bar-chart'; title: string; summary: string; unit: string; scopeLabel: string; periodLabel: string; series: AdvisorPresentationChartSeries[]; evidenceRefs: AdvisorEvidenceRef[]; accessibilityLabel: string }
  | { kind: 'comparison-table'; title: string; summary: string; table: AdvisorPresentationTable; scopeLabel: string; periodLabel: string; evidenceRefs: AdvisorEvidenceRef[] }
  | { kind: 'quota-card'; title: string; summary: string; providers: AdvisorQuotaProvider[]; scopeLabel: string; periodLabel: string; evidenceRefs: AdvisorEvidenceRef[] }
  | { kind: 'bench-summary'; title: string; summary: string; run: AdvisorBenchRun | null; comparison: AdvisorBenchComparison | null; scopeLabel: string; periodLabel: string; evidenceRefs: AdvisorEvidenceRef[] }
  | { kind: 'warning' | 'evidence-disclosure'; title: string; text: string; evidenceRefs: AdvisorEvidenceRef[] }
export type AdvisorEvidence = { intent: AdvisorIntent; question: string; scope: AdvisorScope; refs: AdvisorEvidenceRef[]; coverage: AdvisorCoverage; assumptions: string[]; unknown: string[]; nextInvestigations: string[]; domainCoverage?: AdvisorDomainCoverageV1[]; understanding?: AdvisorQuestionUnderstanding; plan?: AdvisorTurnPlanV1; actionProposal?: AdvisorActionProposalV1; spend?: AdvisorSpendEvidence; modelEfficiency?: AdvisorModelEvidence; quota?: AdvisorQuotaEvidence; bench?: AdvisorBenchEvidence }
export type AdvisorAnswer = { conclusion: string; scopeLabel: string; periodLabel: string; evidence: AdvisorEvidenceRef[]; coverage: AdvisorCoverage; assumptions: string[]; unknown: string[]; nextInvestigations: string[]; details: string[]; why?: string[]; materialLimits?: string[]; understanding?: AdvisorQuestionUnderstanding; plan?: AdvisorTurnPlanV1; actionProposal?: AdvisorActionProposalV1; claims?: AdvisorVerifiedClaimAtomV1[]; synthesis?: AdvisorSynthesisDraftV1; presentation?: AdvisorPresentationBlockV1[]; runtime: { id: string; label: string; mode: 'ollama-local' | 'lmstudio-local' | 'deterministic-local' | 'hosted-byok' | 'unsupported' }; generatedByModel?: boolean; streamed?: boolean }
export type AdvisorLocalRuntimeId = 'ollama' | 'lmstudio'
export type AdvisorHostedProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'opencode-zen'
export type AdvisorCredentialProvider = AdvisorHostedProviderId
export type AdvisorCredentialState = 'not-configured' | 'ready' | 'locked-unavailable' | 'invalid' | 'needs-reentry'
export type AdvisorCredentialStatus = { provider: AdvisorCredentialProvider; state: AdvisorCredentialState }
export type AdvisorHostedModelState = 'discovered' | 'unverified' | 'verified' | 'limited' | 'unsupported' | 'failed-conformance'
export type AdvisorHostedCapabilityState = 'supported' | 'unsupported' | 'unknown' | 'failed-conformance'
export type AdvisorHostedModelCapabilities = { conversational: 'available' | 'unavailable' | 'unknown'; streaming: 'supported' | 'unsupported' | 'unknown'; toolCall: AdvisorHostedCapabilityState }
export type AdvisorHostedModel = { id: string; label: string; state: AdvisorHostedModelState; limitation: string | null; capabilities?: AdvisorHostedModelCapabilities }
export type AdvisorHostedProbe = { provider: AdvisorHostedProviderId; available: boolean; models: AdvisorHostedModel[]; detail: string; credentialState: 'not-configured' | 'ready' | 'locked-unavailable' | 'invalid' | 'needs-reentry' }
export type AdvisorDiscoveryState = 'runtime-unavailable' | 'runtime-available' | 'no-models' | 'models-discovered'
export type AdvisorToolCapability = 'unknown' | 'supported' | 'unsupported' | 'failed-conformance'
export type AdvisorModelCapabilityProfileV1 = {
  schemaVersion: 1
  runtime: AdvisorLocalRuntimeId
  modelId: string
  discovery: 'discovered'
  conversational: 'available' | 'unavailable'
  toolCall: AdvisorToolCapability
  streaming: 'supported' | 'unsupported' | 'unknown'
  limitation: string | null
}
export type AdvisorRuntimeProbe = {
  runtime: AdvisorLocalRuntimeId
  available: boolean
  models: string[]
  detail: string
  discoveryState?: AdvisorDiscoveryState
  capabilities?: AdvisorModelCapabilityProfileV1[]
}
export type AdvisorToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export type AdvisorToolInvocation = { contractVersion: typeof ADVISOR_TOOL_CONTRACT_VERSION; tool: AdvisorToolName; scope: AdvisorScope; arguments: AdvisorJsonObject }
export type AdvisorToolResultEnvelope = {
  contractVersion: typeof ADVISOR_TOOL_CONTRACT_VERSION
  schemaVersion: typeof ADVISOR_TOOL_SCHEMA_VERSION
  tool: AdvisorToolName
  scope: AdvisorScope
  arguments: AdvisorJsonObject
  authority: AdvisorToolAuthority
  freshness: AdvisorToolFreshness
  coverage: AdvisorCoverage
  semantics: AdvisorEvidenceSemantics[]
  evidenceRefs: AdvisorEvidenceRef[]
  unavailable: boolean
  privacy: 'content-minimal'
  output: AdvisorJsonObject
}
export type AdvisorToolContract = {
  contractVersion: typeof ADVISOR_TOOL_CONTRACT_VERSION
  schemaVersion: typeof ADVISOR_TOOL_SCHEMA_VERSION
  tools: readonly AdvisorToolDefinition[]
  scope: { immutable: true; dimensions: readonly string[]; allowedFilters: Readonly<Record<AdvisorToolName, readonly AdvisorToolArgumentName[]>> }
  output: { maxBytes: number; privacy: 'content-minimal'; jsonSafe: true }
}
export type AdvisorToolExecution = { content: string; evidence: AdvisorEvidence; envelope?: AdvisorToolResultEnvelope }
export type AdvisorToolExecutor = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<AdvisorToolExecution>
export type AdvisorConversationTurn = { role: 'user' | 'assistant'; content: string; scopeFingerprint: string }
export type AdvisorUiContextV1 = {
  contractVersion: 'advisor-ui-context-v1'
  schemaVersion: 1
  currentSurface: string
  period: Period
  provider: string
  project: string
  model: string | null
  relevantReferences: readonly string[]
}
export type AdvisorRuntimeInput = {
  question: string
  evidence: AdvisorEvidence
  conversation?: AdvisorConversationTurn[]
  uiContext?: AdvisorUiContextV1
  plan?: AdvisorTurnPlanV1
  fallbackIntent?: AdvisorIntent
  guard?: AdvisorGuardPlanV1
  tools?: readonly AdvisorToolDefinition[]
  toolContract?: AdvisorToolContract
  executeTool?: AdvisorToolExecutor
  onToolEvent?: (event: { name: string; status: 'started' | 'completed' }) => void
  onDelta?: (text: string) => void
}
export interface AdvisorModelRuntime { readonly id: string; readonly label: string; readonly mode: 'ollama-local' | 'lmstudio-local' | 'deterministic-local' | 'hosted-byok' | 'unsupported'; readonly providerSupport: readonly string[]; readonly availability?: 'ready' | 'checking' | 'unavailable'; readonly supportsStreaming?: boolean; generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> }
export type AdvisorDataSource = { getOverview(context: AdvisorScope, signal?: AbortSignal): Promise<MenubarPayload>; getModels(context: AdvisorScope, signal?: AbortSignal): Promise<ModelReportRow[]>; getQuota(signal?: AbortSignal): Promise<QuotaProvider[]>; getBenchEvidence?(context: AdvisorScope, signal?: AbortSignal): Promise<AdvisorBenchEvidence> }
export type AdvisorBridge = Pick<MetroraBridge, 'getOverview' | 'getModels' | 'getQuota' | 'getBenchHistory' | 'getBenchComparison'>
