import type {
  ActionResult,
  AliasRow,
  ActReportJson,
  AuditRow,
  CombinedUsage,
  CompareJsonReport,
  DateRange,
  DeviceScanResult,
  Identity,
  MenubarPayload,
  ModelReportRow,
  ModelStats,
  OptimizeJsonReport,
  Period,
  PriceOverrideList,
  PriceRates,
  QuotaProvider,
  ScanProgressEvent,
  SessionRow,
  ShareStatus,
  SpendFlow,
  StatusJson,
  TelemetryStatus,
  UpdateStatus,
  YieldJsonReport,
} from './types'
import type { ProjectBridge } from './project-bridge-types'
import type { HarnessActionEvent } from '../../electron/act-bridge'
import type { PerformanceRunV1 } from '../../../src/bench/performance-contract-v1'
import type { PerformanceComparisonV1 } from '../../../src/bench/performance-compare-v1'
import type { CanonicalBenchEvidenceV1 } from '../../../src/bench/evidence-contract-v1'
import type {
  HarnessConversation,
  HarnessConversationInput,
  HarnessConversationSummary,
  HarnessCredentialStatus,
  HarnessHostedProbe,
  HarnessHostedProvider,
  HarnessLocalProbe,
  HarnessMcpServerConfig,
  HarnessMcpServerStatus,
  HarnessRuntimeProfileV1,
  HarnessSendMessageInput,
  HarnessSendMessageResult,
  HarnessWorkspace,
  MetroraHarnessRuntimeEvent,
} from '../../electron/harness-runtime-types'

export type MetroraHarnessActionEvent = HarnessActionEvent
export type BenchTaskResult = {
  taskId: string
  attempted: boolean
  status: 'passed' | 'failed' | 'malformed' | 'unavailable' | 'timeout' | 'cancelled'
  score: 0 | 1 | null
  outputDigest: string | null
  outputChars: number | null
  requestLatencyMs: number | null
  timeToFirstContentMs: number | null
  runtimeReported?: {
    totalDurationNs: number | null
    loadDurationNs: number | null
    promptEvalCount: number | null
    promptEvalDurationNs: number | null
    evalCount: number | null
    evalDurationNs: number | null
  }
  failure: { code: string; message: string } | null
}

export type BenchEvaluation = {
  schemaVersion: 'metrora.bench-evaluation.v1'
  runId: string
  runner: { id: string; version: string }
  pack: { packId: string; version: string; digest: string }
  model: { selected: string; reported: string | null }
  runtime: { id: string; endpoint: string; version: string | null }
  environment?: { os: string; arch: string; node: string }
  generation?: { parameters: Record<string, number>; policy: string }
  startedAt: string
  endedAt: string
  status: 'completed' | 'unavailable' | 'cancelled'
  tasks: BenchTaskResult[]
  aggregate: { planned: number; attempted: number; passed: number; failed: number; unavailable: number; cancelled: number; score: { numerator: number; denominator: number; value: number | null } }
  resultDigest: string
}

export type BenchHistoryReport = { schemaVersion: string; records: BenchEvaluation[]; invalidCount: number }
export type BenchModelDiscovery = {
  schemaVersion: 'metrora.bench-model-discovery.v1'
  runtime: { id: 'ollama-local'; endpoint: string }
  status: 'models-discovered' | 'no-models' | 'unavailable'
  models: string[]
  detail: string
  checkedAt: string
}
export type BenchComparison = {
  schemaVersion: 'metrora.bench-comparison.v1'
  compatible: boolean
  reason: string
  left: { runId: string; model: string; endedAt: string }
  right: { runId: string; model: string; endedAt: string }
  deltas: { score: number | null; passed: number; failed: number; unavailable: number; cancelled: number; medianRequestLatencyMs: number | null; medianFirstContentMs: number | null } | null
}
export type PerformanceHistoryReport = { schemaVersion: string; records: PerformanceRunV1[]; invalidCount: number }
export type CanonicalBenchEvidenceReport = CanonicalBenchEvidenceV1
export type PerformanceBenchRequest = {
  executablePath: string
  modelPath: string
  repetitions?: number
  promptTokens?: number
  generationTokens?: number
  batchSize?: number
  ubatchSize?: number
  threads?: number | null
  gpuLayers?: number
  flashAttention?: 'auto' | 'on' | 'off'
  splitMode?: 'none' | 'layer' | 'row'
  mainGpu?: number | null
  warmup?: boolean
  timeoutMs?: number
}

export interface MetroraBridge extends ProjectBridge {
  /** Subscribe to cold-start scan progress; returns an unsubscribe fn. */
  onProgress(cb: (event: ScanProgressEvent) => void): () => void
  /** Read the cached update-availability status (launch + 24h background check). */
  getUpdateStatus(): Promise<UpdateStatus>
  /** Subscribe to pushed update-availability status; returns an unsubscribe fn. */
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
  getQuota(force?: boolean): Promise<QuotaProvider[]>
  harnessProbeLocal(runtime: 'ollama' | 'lmstudio' | 'llama-server', port?: number): Promise<HarnessLocalProbe>
  harnessCancelProbeLocal(runtime: 'ollama' | 'lmstudio' | 'llama-server'): Promise<boolean>
  harnessProbeHosted(provider: HarnessHostedProvider): Promise<HarnessHostedProbe>
  harnessCredentialStatus(provider: HarnessHostedProvider): Promise<HarnessCredentialStatus>
  harnessCredentialSet(provider: HarnessHostedProvider, secret: string): Promise<HarnessCredentialStatus>
  harnessCredentialClear(provider: HarnessHostedProvider): Promise<HarnessCredentialStatus>
  harnessProfileGet(): Promise<HarnessRuntimeProfileV1>
  harnessProfileSetRuntime(runtime: 'ollama' | 'lmstudio' | 'llama-server' | 'hosted'): Promise<HarnessRuntimeProfileV1>
  harnessProfileSetPort(port: number): Promise<HarnessRuntimeProfileV1>
  harnessProfileSetLocalModel(runtime: 'ollama' | 'lmstudio' | 'llama-server', model: string): Promise<HarnessRuntimeProfileV1>
  harnessProfileSetHostedModel(provider: HarnessHostedProvider, model: string): Promise<HarnessRuntimeProfileV1>
  harnessProfileSetReasoning(runtime: 'ollama' | 'lmstudio' | 'llama-server' | 'hosted', provider: HarnessHostedProvider | null, model: string, effort: 'min' | 'low' | 'medium' | 'high' | 'max'): Promise<HarnessRuntimeProfileV1>
  harnessProfileSetConsent(provider: HarnessHostedProvider, state: 'unknown' | 'accepted' | 'declined'): Promise<HarnessRuntimeProfileV1>
  harnessMcpGet(): Promise<HarnessMcpServerStatus[]>
  harnessMcpSetServers(servers: HarnessMcpServerConfig[]): Promise<{ profile: HarnessRuntimeProfileV1; statuses: HarnessMcpServerStatus[] }>
  harnessMcpReload(serverId: string): Promise<HarnessMcpServerStatus[]>
  harnessMcpCredentialStatus(reference: string): Promise<{ reference: string; state: string }>
  harnessMcpCredentialSet(reference: string, secret: string): Promise<{ reference: string; state: string }>
  harnessMcpCredentialClear(reference: string): Promise<{ reference: string; state: string }>
  harnessWorkspaceGet(): Promise<HarnessWorkspace | null>
  harnessWorkspaceOpen(root: string): Promise<HarnessWorkspace>
  harnessWorkspaceClear(): Promise<null>
  getBenchHistory(): Promise<BenchHistoryReport>
  getBenchModelDiscovery(): Promise<BenchModelDiscovery>
  getBenchComparison(leftRunId: string, rightRunId: string): Promise<BenchComparison>
  getBenchEvidence(period: Period, range?: DateRange, model?: string | null, provider?: string, projectId?: string | null): Promise<CanonicalBenchEvidenceReport>
  runBenchTaskPack(model: string, pack?: string): Promise<BenchEvaluation>
  getPerformanceBenchHistory(): Promise<PerformanceHistoryReport>
  getPerformanceBenchComparison(leftRunId: string, rightRunId: string): Promise<PerformanceComparisonV1>
  runPerformanceBench(requestId: string, request: PerformanceBenchRequest): Promise<PerformanceRunV1>
  cancelPerformanceBench(requestId: string): Promise<boolean>
  harnessProposeCoreCompatibility(model: string): Promise<MetroraHarnessActionEvent>
  harnessApproveCoreCompatibility(actionId: string, proposalDigest: string): Promise<MetroraHarnessActionEvent>
  harnessCancelCoreCompatibility(actionId: string): Promise<MetroraHarnessActionEvent | null>
  harnessReadCoreCompatibility(actionId: string): Promise<MetroraHarnessActionEvent | null>
  onHarnessActionEvent(cb: (event: MetroraHarnessActionEvent) => void): () => void
  /** Durable DSH-backed Harness surface. */
  harnessListConversations(): Promise<HarnessConversationSummary[]>
  harnessGetConversation(conversationId: string): Promise<HarnessConversation | null>
  harnessCreateConversation(input: HarnessConversationInput): Promise<HarnessConversation>
  harnessSendMessage(input: HarnessSendMessageInput): Promise<HarnessSendMessageResult>
  harnessCancel(conversationId: string): Promise<boolean>
  onHarnessRuntimeEvent(cb: (event: MetroraHarnessRuntimeEvent) => void): () => void
  harnessApprove(approvalId: string): Promise<boolean>
  harnessDeny(approvalId: string): Promise<boolean>
  harnessCheckConformance(input: HarnessConversationInput): Promise<unknown>
  // `fresh` is reserved for explicit Refresh; navigation reads the snapshot.
  getOverview(period: Period, provider: string, range?: DateRange, configSource?: string | null, background?: boolean, fresh?: boolean, projectScopeId?: string | null): Promise<MenubarPayload>
  getPlans(period: Period): Promise<StatusJson>
  getActReport(): Promise<ActReportJson>
  readonly platform: string
  /** Node process.arch of the host ('arm64', 'x64', ...). Absent on preloads
   *  that predate the direct-download update link. */
  readonly arch?: string
  getModels(period: Period, provider: string, byTask: boolean, range?: DateRange, projectScopeId?: string | null): Promise<ModelReportRow[]>
  getSessions(period: Period, provider: string, range?: DateRange, projectScopeId?: string | null): Promise<SessionRow[]>
  getCompareModels(period: Period, provider: string): Promise<ModelStats[]>
  getCompare(period: Period, provider: string, modelA: string, modelB: string): Promise<CompareJsonReport>
  getYield(period: Period, provider: string, range?: DateRange): Promise<YieldJsonReport>
  getSpendFlow(period: Period, provider: string, range?: DateRange, projectScopeId?: string | null): Promise<SpendFlow>
  getOptimizeReport(period: Period, provider: string, range?: DateRange): Promise<OptimizeJsonReport>
  getDevices(period: Period): Promise<CombinedUsage>
  getDevicesScan(): Promise<DeviceScanResult>
  getShareStatus(): Promise<ShareStatus>
  startShare(always?: boolean): Promise<ShareStatus>; stopShare(): Promise<ShareStatus>; approvePairing(id: string, approve: boolean): Promise<ShareStatus>
  getIdentity(): Promise<Identity>
  getAliases(): Promise<AliasRow[]>
  getProxyPaths(): Promise<string[]>
  getAudit(period: Period, provider: string, range?: DateRange): Promise<AuditRow[]>
  getPriceOverrides(): Promise<PriceOverrideList>
  setPriceOverride(model: string, rates: PriceRates): Promise<ActionResult>
  removePriceOverride(model: string): Promise<ActionResult>
  setCurrency(code: string): Promise<ActionResult>
  resetCurrency(): Promise<ActionResult>
  addAlias(from: string, to: string): Promise<ActionResult>
  removeAlias(from: string): Promise<ActionResult>
  removeDevice(name: string): Promise<ActionResult>
  setPlan(id: string, provider: string): Promise<ActionResult>
  resetPlan(provider: string): Promise<ActionResult>
  exportData(format: string, provider: string, outPath: string): Promise<ActionResult>
  saveShareCardPng(suggestedName: string, pngDataUrl: string): Promise<boolean>
  chooseDirectory(): Promise<string | null>
  chooseFile(kind: 'llama-bench' | 'gguf'): Promise<string | null>
  cliStatus(): Promise<{ found: boolean; path: string | null; error?: string }>
  telemetryStatus(): Promise<TelemetryStatus | null>
  setTelemetryEnabled(enabled: boolean): Promise<TelemetryStatus | null>
  completeOnboarding(enabled: boolean): Promise<TelemetryStatus | null>
  telemetryTrack(name: string, props?: Record<string, unknown>): Promise<boolean>
  openExternal(url: string): Promise<void>
}
