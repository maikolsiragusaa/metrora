import type { MetroraBridge } from '../lib/metrora-bridge-types'
import type { DateRange, MenubarPayload, ModelReportRow, Period, QuotaProvider } from '../lib/types'

export type AdvisorIntent = 'spend-change' | 'model-efficiency' | 'quota-capacity' | 'unknown'
export type AdvisorScope = { period: Period; range: DateRange | null; provider: string; projectId: string; projectName: string; model: string | null }
export type AdvisorCoverageLevel = 'high' | 'partial' | 'unavailable'
export type AdvisorCoverage = { level: AdvisorCoverageLevel; label: string; detail: string }
export type AdvisorEvidenceSource = 'overview' | 'history' | 'models' | 'quota'
export type AdvisorEvidenceRef = { id: string; label: string; source: AdvisorEvidenceSource }
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
export type AdvisorToolExecution = { content: string; evidence: AdvisorEvidence }
export type AdvisorToolExecutor = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<AdvisorToolExecution>
export type AdvisorConversationTurn = { role: 'user' | 'assistant'; content: string }
export type AdvisorRuntimeInput = { question: string; evidence: AdvisorEvidence; conversation?: AdvisorConversationTurn[]; tools?: readonly AdvisorToolDefinition[]; executeTool?: AdvisorToolExecutor; onToolEvent?: (event: { name: string; status: 'started' | 'completed' }) => void; onDelta?: (text: string) => void }
export interface AdvisorModelRuntime { readonly id: string; readonly label: string; readonly mode: 'ollama-local' | 'deterministic-local' | 'unsupported'; readonly providerSupport: readonly string[]; readonly availability?: 'ready' | 'checking' | 'unavailable'; readonly supportsStreaming?: boolean; generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> }
export type AdvisorDataSource = { getOverview(context: AdvisorScope): Promise<MenubarPayload>; getModels(context: AdvisorScope): Promise<ModelReportRow[]>; getQuota(): Promise<QuotaProvider[]> }
export type AdvisorBridge = Pick<MetroraBridge, 'getOverview' | 'getModels' | 'getQuota'>
