import { contextBridge, ipcRenderer } from 'electron'

import type { Envelope } from './main'

type DateRange = { from: string; to: string }
type PriceRates = { input?: number; output?: number; cacheRead?: number; cacheCreation?: number }
type CreateWorkspaceInput = { displayName: string; slug?: string; endpointDisplayName: string }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (res.ok) return res.value
  return Promise.reject(res.error)
}

// The legacy IPC channel names remain behind this adapter until main-process
// aliases are installed. Renderer code receives Metrora as the canonical bridge
// immediately, while old windows/integrations can keep using window.metrora.
const bridge = {
  getQuota: (force?: boolean) => invoke('metrora:getQuota', force),
  getOverview: (period: string, provider: string, range?: DateRange, configSource?: string | null, background?: boolean) => invoke('metrora:getOverview', period, provider, range, configSource, background),
  getPlans: (period: string) => invoke('metrora:getPlans', period),
  getActReport: () => invoke('metrora:getActReport'),
  getModels: (period: string, provider: string, byTask: boolean, range?: DateRange) => invoke('metrora:getModels', period, provider, byTask, range),
  getSessions: (period: string, provider: string, range?: DateRange) => invoke('metrora:getSessions', period, provider, range),
  getCompareModels: (period: string, provider: string) => invoke('metrora:getCompareModels', period, provider),
  getCompare: (period: string, provider: string, modelA: string, modelB: string) => invoke('metrora:getCompare', period, provider, modelA, modelB),
  getYield: (period: string, provider: string, range?: DateRange) => invoke('metrora:getYield', period, provider, range),
  getSpendFlow: (period: string, provider: string, range?: DateRange) => invoke('metrora:getSpendFlow', period, provider, range),
  getOptimizeReport: (period: string, provider: string, range?: DateRange) => invoke('metrora:getOptimizeReport', period, provider, range),
  getDevices: (period: string) => invoke('metrora:getDevices', period),
  getDevicesScan: () => invoke('metrora:getDevicesScan'),
  getShareStatus: () => invoke('metrora:getShareStatus'),
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
  chooseDirectory: () => invoke('metrora:chooseDirectory'),
  cliStatus: () => invoke('metrora:cliStatus'),

  getWorkspaceStatus: () => invoke('metrora:getWorkspaceStatus'),
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
