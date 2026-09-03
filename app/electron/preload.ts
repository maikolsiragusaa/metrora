import { contextBridge, ipcRenderer } from 'electron'

import type { Envelope } from './main'
import type { HarnessActionEvent } from './act-bridge'
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
  HarnessReasoningEffort,
  HarnessSendMessageInput,
  HarnessSendMessageResult,
  HarnessWorkspace,
  MetroraHarnessRuntimeEvent,
} from './harness-runtime-types'

type DateRange = { from: string; to: string }
type PriceRates = { input?: number; output?: number; cacheRead?: number; cacheCreation?: number }
type CreateWorkspaceInput = { displayName: string; slug?: string; endpointDisplayName: string }
type PerformanceBenchRequest = {
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

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (res.ok) return res.value
  return Promise.reject(res.error)
}

const bridge = {
  getQuota: (force?: boolean) => invoke('metrora:getQuota', force),
  harnessProbeLocal: (runtime: 'ollama' | 'lmstudio' | 'llama-server', port?: number) => invoke<HarnessLocalProbe>('metrora:harnessProbeLocal', runtime, port),
  harnessCancelProbeLocal: (runtime: 'ollama' | 'lmstudio' | 'llama-server') => invoke<boolean>('metrora:harnessCancelProbeLocal', runtime),
  harnessProbeHosted: (provider: HarnessHostedProvider) => invoke<HarnessHostedProbe>('metrora:harnessProbeHosted', provider),
  harnessCredentialStatus: (provider: HarnessHostedProvider) => invoke<HarnessCredentialStatus>('metrora:harnessCredentialStatus', provider),
  harnessCredentialSet: (provider: HarnessHostedProvider, secret: string) => invoke<HarnessCredentialStatus>('metrora:harnessCredentialSet', provider, secret),
  harnessCredentialClear: (provider: HarnessHostedProvider) => invoke<HarnessCredentialStatus>('metrora:harnessCredentialClear', provider),
  harnessProfileGet: () => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileGet'),
  harnessProfileSetRuntime: (runtime: 'ollama' | 'lmstudio' | 'llama-server' | 'hosted') => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileSetRuntime', runtime),
  harnessProfileSetPort: (port: number) => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileSetPort', port),
  harnessProfileSetLocalModel: (runtime: 'ollama' | 'lmstudio' | 'llama-server', model: string) => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileSetLocalModel', runtime, model),
  harnessProfileSetHostedModel: (provider: HarnessHostedProvider, model: string) => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileSetHostedModel', provider, model),
  harnessProfileSetReasoning: (runtime: 'ollama' | 'lmstudio' | 'llama-server' | 'hosted', provider: HarnessHostedProvider | null, model: string, effort: HarnessReasoningEffort) => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileSetReasoning', runtime, provider, model, effort),
  harnessProfileSetReasoningCapabilities: (runtime: 'ollama' | 'lmstudio' | 'llama-server' | 'hosted', provider: HarnessHostedProvider | null, model: string, efforts: HarnessReasoningEffort[]) => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileSetReasoningCapabilities', runtime, provider, model, efforts),
  harnessProfileSetConsent: (provider: HarnessHostedProvider, state: 'unknown' | 'accepted' | 'declined') => invoke<HarnessRuntimeProfileV1>('metrora:harnessProfileSetConsent', provider, state),
  harnessMcpGet: () => invoke<HarnessMcpServerStatus[]>('metrora:harnessMcpGet'),
  harnessMcpSetServers: (servers: HarnessMcpServerConfig[]) => invoke<{ profile: HarnessRuntimeProfileV1; statuses: HarnessMcpServerStatus[] }>('metrora:harnessMcpSetServers', servers),
  harnessMcpReload: (serverId: string) => invoke<HarnessMcpServerStatus[]>('metrora:harnessMcpReload', serverId),
  harnessMcpCredentialStatus: (reference: string) => invoke<{ reference: string; state: string }>('metrora:harnessMcpCredentialStatus', reference),
  harnessMcpCredentialSet: (reference: string, secret: string) => invoke<{ reference: string; state: string }>('metrora:harnessMcpCredentialSet', reference, secret),
  harnessMcpCredentialClear: (reference: string) => invoke<{ reference: string; state: string }>('metrora:harnessMcpCredentialClear', reference),
  harnessWorkspaceGet: () => invoke<HarnessWorkspace | null>('metrora:harnessWorkspaceGet'),
  harnessWorkspaceOpen: (root: string) => invoke<HarnessWorkspace>('metrora:harnessWorkspaceOpen', root),
  harnessWorkspaceClear: () => invoke<null>('metrora:harnessWorkspaceClear'),
  getBenchHistory: () => invoke('metrora:getBenchHistory'),
  getBenchModelDiscovery: () => invoke('metrora:getBenchModelDiscovery'),
  getBenchComparison: (leftRunId: string, rightRunId: string) => invoke('metrora:getBenchComparison', leftRunId, rightRunId),
  getBenchEvidence: (period: string, range?: DateRange, model?: string | null, provider?: string, projectId?: string | null) => invoke('metrora:getBenchEvidence', period, range, model, provider, projectId),
  runBenchTaskPack: (model: string, pack?: string) => invoke('metrora:runBenchTaskPack', model, pack),
  getPerformanceBenchHistory: () => invoke('metrora:getPerformanceBenchHistory'),
  getPerformanceBenchComparison: (leftRunId: string, rightRunId: string) => invoke('metrora:getPerformanceBenchComparison', leftRunId, rightRunId),
  runPerformanceBench: (requestId: string, request: PerformanceBenchRequest) => invoke('metrora:runPerformanceBench', requestId, request),
  cancelPerformanceBench: (requestId: string) => invoke('metrora:cancelPerformanceBench', requestId),
  getOverview: (period: string, provider: string, range?: DateRange, configSource?: string | null, background?: boolean, fresh?: boolean, projectScopeId?: string | null) => invoke('metrora:getOverview', period, provider, range, configSource, background, fresh, projectScopeId),
  getProjects: () => invoke('metrora:getProjects'),
  createProject: (name: string, icon?: string, color?: string) => invoke('metrora:createProject', name, icon, color),
  updateProject: (id: string, patch: { name?: string; icon?: string; color?: string }) => invoke('metrora:updateProject', id, patch),
  deleteProject: (id: string) => invoke('metrora:deleteProject', id),
  assignSourceProject: (projectId: string, sourceProjectId: string) => invoke('metrora:assignSourceProject', projectId, sourceProjectId),
  unassignSourceProject: (sourceProjectId: string) => invoke('metrora:unassignSourceProject', sourceProjectId),
  getPlans: (period: string) => invoke('metrora:getPlans', period),
  getActReport: () => invoke('metrora:getActReport'),
  getModels: (period: string, provider: string, byTask: boolean, range?: DateRange, projectScopeId?: string | null) => invoke('metrora:getModels', period, provider, byTask, range, projectScopeId),
  getSessions: (period: string, provider: string, range?: DateRange, projectScopeId?: string | null) => invoke('metrora:getSessions', period, provider, range, projectScopeId),
  getCompareModels: (period: string, provider: string) => invoke('metrora:getCompareModels', period, provider),
  getCompare: (period: string, provider: string, modelA: string, modelB: string) => invoke('metrora:getCompare', period, provider, modelA, modelB),
  getYield: (period: string, provider: string, range?: DateRange) => invoke('metrora:getYield', period, provider, range),
  getSpendFlow: (period: string, provider: string, range?: DateRange, projectScopeId?: string | null) => invoke('metrora:getSpendFlow', period, provider, range, projectScopeId),
  getOptimizeReport: (period: string, provider: string, range?: DateRange) => invoke('metrora:getOptimizeReport', period, provider, range),
  getDevices: (period: string) => invoke('metrora:getDevices', period),
  getDevicesScan: () => invoke('metrora:getDevicesScan'),
  getShareStatus: () => invoke('metrora:getShareStatus'),
  startShare: (always?: boolean) => invoke('metrora:startShare', always),
  stopShare: () => invoke('metrora:stopShare'),
  approvePairing: (id: string, approve: boolean) => invoke('metrora:approvePairing', id, approve),
  getIdentity: () => invoke('metrora:getIdentity'),
  getAliases: () => invoke('metrora:getAliases'),
  getProxyPaths: () => invoke('metrora:getProxyPaths'),
  getAudit: (period: string, provider: string, range?: DateRange) => invoke('metrora:getAudit', period, provider, range),
  getPriceOverrides: () => invoke('metrora:getPriceOverrides'),
  setPriceOverride: (model: string, rates: PriceRates) => invoke('metrora:setPriceOverride', model, rates),
  removePriceOverride: (model: string) => invoke('metrora:removePriceOverride', model),
  setCurrency: (code: string) => invoke('metrora:setCurrency', code),
  resetCurrency: () => invoke('metrora:resetCurrency'),
  addAlias: (from: string, to: string) => invoke('metrora:addAlias', from, to),
  removeAlias: (from: string) => invoke('metrora:removeAlias', from),
  removeDevice: (name: string) => invoke('metrora:removeDevice', name),
  setPlan: (id: string, provider: string) => invoke('metrora:setPlan', id, provider),
  resetPlan: (provider: string) => invoke('metrora:resetPlan', provider),
  exportData: (format: string, provider: string, outPath: string) => invoke('metrora:exportData', format, provider, outPath),
  saveShareCardPng: (suggestedName: string, pngDataUrl: string) => invoke('metrora:saveShareCardPng', suggestedName, pngDataUrl),
  chooseDirectory: () => invoke('metrora:chooseDirectory'),
  chooseFile: (kind: 'llama-bench' | 'gguf') => invoke('metrora:chooseFile', kind),
  cliStatus: () => invoke('metrora:cliStatus'),

  getWorkspaceStatus: () => invoke('metrora:getWorkspaceStatus'),
  retryWorkspaceStatus: () => invoke('metrora:retryWorkspaceStatus'),
  inspectWorkspaceStatus: () => invoke('metrora:inspectWorkspaceStatus'),
  createWorkspace: (input: CreateWorkspaceInput) => invoke('metrora:createWorkspace', input),
  pauseWorkspaceProduction: () => invoke('metrora:pauseWorkspaceProduction'),
  resumeWorkspaceProduction: () => invoke('metrora:resumeWorkspaceProduction'),
  produceWorkspaceMeasurements: () => invoke('metrora:produceWorkspaceMeasurements'),
  recoverWorkspaceState: () => invoke('metrora:recoverWorkspaceState'),
  createWorkspaceBatch: () => invoke('metrora:createWorkspaceBatch'),
  exportWorkspaceEvidence: () => invoke('metrora:exportWorkspaceEvidence'),

  // Metrora performs no product telemetry. Compatibility calls settle locally.
  telemetryStatus: async () => null,
  setTelemetryEnabled: async (_enabled: boolean) => null,
  completeOnboarding: async (_enabled: boolean) => null,
  telemetryTrack: async (_name: string, _props?: Record<string, unknown>) => true,

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onProgress: (cb: (event: unknown) => void) => {
    const listener = (_event: unknown, event: unknown) => cb(event)
    ipcRenderer.on('metrora:progress', listener)
    return () => { ipcRenderer.removeListener('metrora:progress', listener) }
  },
  getUpdateStatus: () => invoke('metrora:getUpdateStatus'),
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => cb(status)
    ipcRenderer.on('metrora:update', listener)
    return () => { ipcRenderer.removeListener('metrora:update', listener) }
  },
  harnessProposeCoreCompatibility: (model: string) => invoke('metrora:harnessProposeCoreCompatibility', model) as Promise<HarnessActionEvent>,
  harnessApproveCoreCompatibility: (actionId: string, proposalDigest: string) => invoke('metrora:harnessApproveCoreCompatibility', actionId, proposalDigest) as Promise<HarnessActionEvent>,
  harnessCancelCoreCompatibility: (actionId: string) => invoke('metrora:harnessCancelCoreCompatibility', actionId) as Promise<HarnessActionEvent | null>,
  harnessReadCoreCompatibility: (actionId: string) => invoke('metrora:harnessReadCoreCompatibility', actionId) as Promise<HarnessActionEvent | null>,
  onHarnessActionEvent: (cb: (event: HarnessActionEvent) => void) => {
    const listener = (_event: unknown, event: HarnessActionEvent) => cb(event)
    ipcRenderer.on('metrora:harnessActionEvent', listener)
    return () => { ipcRenderer.removeListener('metrora:harnessActionEvent', listener) }
  },
  harnessListConversations: () => invoke<HarnessConversationSummary[]>('metrora:harnessListConversations'),
  harnessGetConversation: (conversationId: string) => invoke<HarnessConversation | null>('metrora:harnessGetConversation', conversationId),
  harnessCreateConversation: (input: HarnessConversationInput) => invoke<HarnessConversation>('metrora:harnessCreateConversation', input),
  harnessSelectModelForSession: (input: HarnessConversationInput) => invoke<HarnessConversation | null>('metrora:harnessSelectModelForSession', input),
  harnessSendMessage: (input: HarnessSendMessageInput) => invoke<HarnessSendMessageResult>('metrora:harnessSendMessage', input),
  harnessCancel: (conversationId: string) => invoke<boolean>('metrora:harnessCancel', conversationId),
  harnessApprove: (approvalId: string) => invoke<boolean>('metrora:harnessApprove', approvalId),
  harnessDeny: (approvalId: string) => invoke<boolean>('metrora:harnessDeny', approvalId),
  harnessCheckConformance: (input: HarnessConversationInput) => invoke<unknown>('metrora:harnessCheckConformance', input),
  onHarnessRuntimeEvent: (cb: (event: MetroraHarnessRuntimeEvent) => void) => {
    const listener = (_event: unknown, event: MetroraHarnessRuntimeEvent) => cb(event)
    ipcRenderer.on('metrora:harnessRuntimeEvent', listener)
    return () => { ipcRenderer.removeListener('metrora:harnessRuntimeEvent', listener) }
  },
  platform: process.platform,
  arch: process.arch,
}

contextBridge.exposeInMainWorld('metrora', bridge)
