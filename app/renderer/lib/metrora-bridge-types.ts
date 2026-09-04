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
import type { PerformanceRunV1 } from '../../../src/bench/performance-contract-v1'
import type { PerformanceComparisonV1 } from '../../../src/bench/performance-compare-v1'
import type { CanonicalBenchEvidenceV1 } from '../../../src/bench/evidence-contract-v1'
import type {
  OpenCodeAgent,
  OpenCodeConversationMessage,
  OpenCodeEngineStatus,
  OpenCodeLocalProviderConfig,
  OpenCodeMcpServer,
  OpenCodeProvider,
  OpenCodeRendererEvent,
  OpenCodeSession,
  OpenCodeTools,
  OpenCodeWorkspaceInfo,
} from '../../electron/opencode-types'

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
  getBenchHistory(): Promise<BenchHistoryReport>
  getBenchModelDiscovery(): Promise<BenchModelDiscovery>
  getBenchComparison(leftRunId: string, rightRunId: string): Promise<BenchComparison>
  getBenchEvidence(period: Period, range?: DateRange, model?: string | null, provider?: string, projectId?: string | null): Promise<CanonicalBenchEvidenceReport>
  runBenchTaskPack(model: string, pack?: string): Promise<BenchEvaluation>
  getPerformanceBenchHistory(): Promise<PerformanceHistoryReport>
  getPerformanceBenchComparison(leftRunId: string, rightRunId: string): Promise<PerformanceComparisonV1>
  runPerformanceBench(requestId: string, request: PerformanceBenchRequest): Promise<PerformanceRunV1>
  cancelPerformanceBench(requestId: string): Promise<boolean>
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
  opencodeStatus(): Promise<OpenCodeEngineStatus>
  opencodeStart(): Promise<OpenCodeEngineStatus>
  opencodeRestart(): Promise<OpenCodeEngineStatus>
  opencodeSetWorkspace(workspace: string): Promise<OpenCodeEngineStatus>
  opencodeListSessions(): Promise<OpenCodeSession[]>
  opencodeCreateSession(title?: string): Promise<OpenCodeSession>
  opencodeGetMessages(sessionId: string): Promise<OpenCodeConversationMessage[]>
  opencodePrompt(request: Record<string, unknown>): Promise<OpenCodeConversationMessage | null>
  opencodeCancel(requestId: string): Promise<boolean>
  opencodeListProviders(): Promise<OpenCodeProvider[]>
  opencodeListAgents(): Promise<OpenCodeAgent[]>
  opencodeListTools(): Promise<OpenCodeTools>
  opencodeGetWorkspace(): Promise<OpenCodeWorkspaceInfo>
  opencodeGetMcp(): Promise<OpenCodeMcpServer[]>
  opencodePermissionReply(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<boolean>
  opencodeConfigureLocal(config: OpenCodeLocalProviderConfig): Promise<OpenCodeEngineStatus>
  onOpenCodeEvent(cb: (event: OpenCodeRendererEvent) => void): () => void
  telemetryStatus(): Promise<TelemetryStatus | null>
  setTelemetryEnabled(enabled: boolean): Promise<TelemetryStatus | null>
  completeOnboarding(enabled: boolean): Promise<TelemetryStatus | null>
  telemetryTrack(name: string, props?: Record<string, unknown>): Promise<boolean>
  openExternal(url: string): Promise<void>
}
