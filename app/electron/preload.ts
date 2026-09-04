import { contextBridge, ipcRenderer } from 'electron'

import type { Envelope } from './main'
import type { OpenCodeRuntimeStatus } from './opencode/types'

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
type OpenCodeBounds = { x: number; y: number; width: number; height: number }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (res.ok) return res.value
  return Promise.reject(res.error)
}

// Keep the renderer-facing API narrow; all privileged work remains behind the
// validated main-process handlers.
const bridge = {
  getQuota: (force?: boolean) => invoke('metrora:getQuota', force),
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
  opencodeActivate: (bounds: OpenCodeBounds) => invoke('metrora:opencodeActivate', bounds) as Promise<OpenCodeRuntimeStatus>,
  opencodeUpdateBounds: (bounds: OpenCodeBounds) => invoke('metrora:opencodeBounds', bounds) as Promise<boolean>,
  opencodeDeactivate: () => invoke('metrora:opencodeDeactivate') as Promise<boolean>,

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
  platform: process.platform,
  arch: process.arch,
}

contextBridge.exposeInMainWorld('metrora', bridge)
