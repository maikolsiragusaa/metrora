import { contextBridge, ipcRenderer } from 'electron'

import type { Envelope } from './main'

type DateRange = { from: string; to: string }
type PriceRates = { input?: number; output?: number; cacheRead?: number; cacheCreation?: number }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (res.ok) return res.value
  return Promise.reject(res.error)
}

// The legacy IPC channel names remain behind this adapter until main-process
// aliases are installed. Renderer code receives Qovrion as the canonical bridge
// immediately, while old windows/integrations can keep using window.codeburn.
const bridge = {
  getQuota: (force?: boolean) => invoke('qovrion:getQuota', force),
  getOverview: (period: string, provider: string, range?: DateRange, configSource?: string | null, background?: boolean) => invoke('qovrion:getOverview', period, provider, range, configSource, background),
  getPlans: (period: string) => invoke('qovrion:getPlans', period),
  getActReport: () => invoke('qovrion:getActReport'),
  getModels: (period: string, provider: string, byTask: boolean, range?: DateRange) => invoke('qovrion:getModels', period, provider, byTask, range),
  getSessions: (period: string, provider: string, range?: DateRange) => invoke('qovrion:getSessions', period, provider, range),
  getCompareModels: (period: string, provider: string) => invoke('qovrion:getCompareModels', period, provider),
  getCompare: (period: string, provider: string, modelA: string, modelB: string) => invoke('qovrion:getCompare', period, provider, modelA, modelB),
  getYield: (period: string, provider: string, range?: DateRange) => invoke('qovrion:getYield', period, provider, range),
  getSpendFlow: (period: string, provider: string, range?: DateRange) => invoke('qovrion:getSpendFlow', period, provider, range),
  getOptimizeReport: (period: string, provider: string, range?: DateRange) => invoke('qovrion:getOptimizeReport', period, provider, range),
  getDevices: (period: string) => invoke('qovrion:getDevices', period),
  getDevicesScan: () => invoke('qovrion:getDevicesScan'),
  getShareStatus: () => invoke('qovrion:getShareStatus'),
  getIdentity: () => invoke('qovrion:getIdentity'),
  getAliases: () => invoke('qovrion:getAliases'),
  getProxyPaths: () => invoke('qovrion:getProxyPaths'),
  getAudit: (period: string, provider: string, range?: DateRange) => invoke('qovrion:getAudit', period, provider, range),
  getPriceOverrides: () => invoke('qovrion:getPriceOverrides'),
  setPriceOverride: (model: string, rates: PriceRates) => invoke('qovrion:setPriceOverride', model, rates),
  removePriceOverride: (model: string) => invoke('qovrion:removePriceOverride', model),
  setCurrency: (code: string) => invoke('qovrion:setCurrency', code),
  resetCurrency: () => invoke('qovrion:resetCurrency'),
  addAlias: (from: string, to: string) => invoke('qovrion:addAlias', from, to),
  removeAlias: (from: string) => invoke('qovrion:removeAlias', from),
  removeDevice: (name: string) => invoke('qovrion:removeDevice', name),
  setPlan: (id: string, provider: string) => invoke('qovrion:setPlan', id, provider),
  resetPlan: (provider: string) => invoke('qovrion:resetPlan', provider),
  exportData: (format: string, provider: string, outPath: string) => invoke('qovrion:exportData', format, provider, outPath),
  chooseDirectory: () => invoke('qovrion:chooseDirectory'),
  cliStatus: () => invoke('qovrion:cliStatus'),

  // Qovrion performs no product telemetry. Compatibility calls settle locally.
  telemetryStatus: async () => null,
  setTelemetryEnabled: async (_enabled: boolean) => null,
  completeOnboarding: async (_enabled: boolean) => null,
  telemetryTrack: async (_name: string, _props?: Record<string, unknown>) => true,

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onProgress: (cb: (event: unknown) => void) => {
    const listener = (_event: unknown, event: unknown) => cb(event)
    ipcRenderer.on('qovrion:progress', listener)
    return () => { ipcRenderer.removeListener('qovrion:progress', listener) }
  },
  getUpdateStatus: () => invoke('qovrion:getUpdateStatus'),
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => cb(status)
    ipcRenderer.on('qovrion:update', listener)
    return () => { ipcRenderer.removeListener('qovrion:update', listener) }
  },
  platform: process.platform,
  arch: process.arch,
}

contextBridge.exposeInMainWorld('qovrion', bridge)
contextBridge.exposeInMainWorld('codeburn', bridge)
