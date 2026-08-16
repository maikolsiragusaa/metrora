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

export interface MetroraBridge extends ProjectBridge {
  /** Subscribe to cold-start scan progress; returns an unsubscribe fn. */
  onProgress(cb: (event: ScanProgressEvent) => void): () => void
  /** Read the cached update-availability status (launch + 24h background check). */
  getUpdateStatus(): Promise<UpdateStatus>
  /** Subscribe to pushed update-availability status; returns an unsubscribe fn. */
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
  getQuota(force?: boolean): Promise<QuotaProvider[]>
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
  chooseDirectory(): Promise<string | null>
  cliStatus(): Promise<{ found: boolean; path: string | null; error?: string }>
  telemetryStatus(): Promise<TelemetryStatus | null>
  setTelemetryEnabled(enabled: boolean): Promise<TelemetryStatus | null>
  completeOnboarding(enabled: boolean): Promise<TelemetryStatus | null>
  telemetryTrack(name: string, props?: Record<string, unknown>): Promise<boolean>
  openExternal(url: string): Promise<void>
}
