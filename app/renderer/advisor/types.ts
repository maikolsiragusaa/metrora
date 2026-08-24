import type { MetroraBridge } from '../lib/metrora-bridge-types'
import type { DateRange, MenubarPayload, ModelReportRow, Period, QuotaProvider } from '../lib/types'

export type AdvisorIntent = 'spend-change' | 'model-efficiency' | 'quota-capacity' | 'unknown'
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
export type AdvisorCoverage = { level: AdvisorCoverageLevel; label: string; detail: string }
export type AdvisorEvidenceSource = 'overview' | 'history' | 'models' | 'quota'
export type AdvisorEvidenceRef = { id: string; label: string; source: AdvisorEvidenceSource }
export type AdvisorJsonValue = null | string | number | boolean | { [key: string]: AdvisorJsonValue } | AdvisorJsonValue[]
export type AdvisorJsonObject = { [key: string]: AdvisorJsonValue }
export type AdvisorToolName = 'get_spend_snapshot' | 'get_model_efficiency' | 'get_quota_snapshot' | 'get_overview_snapshot' | 'get_project_drivers' | 'get_session_highlights' | 'get_coverage_report'
export type AdvisorToolArgumentName = 'model' | 'provider'
export type AdvisorToolAuthority = 'metrora-canonical' | 'provider-reported' | 'mixed' | 'unknown'
export type AdvisorToolFreshness = 'fresh' | 'stale' | 'mixed' | 'unavailable' | 'unknown'
export type AdvisorEvidenceValueStatus = 'observed' | 'derived' | 'estimated' | 'unknown'
export type AdvisorEvidenceSemantics = { source: AdvisorEvidenceSource | 'unknown'; authority: AdvisorToolAuthority; status: AdvisorEvidenceValueStatus }
export const ADVISOR_TOOL_CONTRACT_VERSION = 'advisor-tool-v1' as const
export const ADVISOR_TOOL_SCHEMA_VERSION = 1 as const
export type AdvisorSpendDriver = { name: string; costUSD: number; calls: number }
export type AdvisorTrend = { direction: 'up' | 'down' | 'flat'; latestCostUSD: number; comparisonCostUSD: number; deltaUSD: number; deltaPercent: number | null; latestDate: string; comparisonLabel: string }
export type AdvisorSpendEvidence = { measuredCostUSD: number | null; calls: number | null; sessions: number | null; models: AdvisorSpendDriver[]; projects: AdvisorSpendDriver[]; sessionsByCost: AdvisorSpendDriver[]; trend: AdvisorTrend | null; pricingCoverage: number | null }
export type AdvisorModelEvidenceRow = { model: string; provider: string; calls: number; costUSD: number; outputTokens: number | null; costPerCallUSD: number | null; pricingState: 'priced' | 'partial' | 'unavailable' | 'unknown' }
export type AdvisorModelEvidence = { rows: AdvisorModelEvidenceRow[]; selectedModel: string | null; comparableWorkWarning: boolean }
export type AdvisorQuotaWindow = { id: string; label: string; usedPercent: number; remainingPercent: number; resetsAt: string | null }
export type AdvisorQuotaProvider = { provider: QuotaProvider['provider']; planLabel: string | null; availability: QuotaProvider['availability']; connection: QuotaProvider['connection']; freshness: QuotaProvider['freshness']; observedAt: string | null; windows: AdvisorQuotaWindow[]; creditsUSD: number | null }
export type AdvisorQuotaEvidence = { providers: AdvisorQuotaProvider[]; measuredSpendUSD: number | null; measuredCalls: number | null }
export type AdvisorEvidence = { intent: AdvisorIntent; question: string; scope: AdvisorScope; refs: AdvisorEvidenceRef[]; coverage: AdvisorCoverage; assumptions: string[]; unknown: string[]; nextInvestigations: string[]; spend?: AdvisorSpendEvidence; modelEfficiency?: AdvisorModelEvidence; quota?: AdvisorQuotaEvidence }
export type AdvisorAnswer = { conclusion: string; scopeLabel: string; periodLabel: string; evidence: AdvisorEvidenceRef[]; coverage: AdvisorCoverage; assumptions: string[]; unknown: string[]; nextInvestigations: string[]; details: string[]; runtime: { id: string; label: string; mode: 'ollama-local' | 'deterministic-local' | 'unsupported' }; generatedByModel?: boolean; streamed?: boolean }
export type AdvisorToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export type AdvisorToolInvocation = { contractVersion: typeof ADVISOR_TOOL_CONTRACT_VERSION; tool: AdvisorToolName; scope: AdvisorScope; arguments: AdvisorJsonObject }
export type AdvisorToolResultEnvelope = {
  contractVersion: typeof ADVISOR_TOOL_CONTRACT_VERSION
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
export type AdvisorRuntimeInput = { question: string; evidence: AdvisorEvidence; conversation?: AdvisorConversationTurn[]; tools?: readonly AdvisorToolDefinition[]; toolContract?: AdvisorToolContract; executeTool?: AdvisorToolExecutor; onToolEvent?: (event: { name: string; status: 'started' | 'completed' }) => void; onDelta?: (text: string) => void }
export interface AdvisorModelRuntime { readonly id: string; readonly label: string; readonly mode: 'ollama-local' | 'deterministic-local' | 'unsupported'; readonly providerSupport: readonly string[]; readonly availability?: 'ready' | 'checking' | 'unavailable'; readonly supportsStreaming?: boolean; generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> }
export type AdvisorDataSource = { getOverview(context: AdvisorScope, signal?: AbortSignal): Promise<MenubarPayload>; getModels(context: AdvisorScope, signal?: AbortSignal): Promise<ModelReportRow[]>; getQuota(signal?: AbortSignal): Promise<QuotaProvider[]> }
export type AdvisorBridge = Pick<MetroraBridge, 'getOverview' | 'getModels' | 'getQuota'>
