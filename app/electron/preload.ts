import { contextBridge, ipcRenderer } from 'electron'

// Handlers resolve with { ok, value } | { ok, error } so the structured error
// `kind` survives the contextBridge boundary. `import type` is erased at build,
// so this shares main.ts's declaration without pulling its runtime in.
import type { Envelope } from './main'

type DateRange = { from: string; to: string }
type PriceRates = { input?: number; output?: number; cacheRead?: number; cacheCreation?: number }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (res.ok) return res.value
  return Promise.reject(res.error)
}

// Shape matches CodeburnBridge (app/renderer/lib/types.ts). The `codeburn`
// property name and IPC channels remain a temporary compatibility boundary.
const bridge = {
  getQuota: (force?: boolean) => invoke('codeburn:getQuota', force),
  getOverview: (period: string, provider: string, range?: DateRange, configSource?: string | null, background?: boolean) => invoke('codeburn:getOverview', period, provider, range, configSource, background),
  getPlans: (period: string) => invoke('codeburn:getPlans', period),
  getActReport: () => invoke('codeburn:getActReport'),
  getModels: (period: string, provider: string, byTask: boolean, range?: DateRange) => invoke('codeburn:getModels', period, provider, byTask, range),
  getSessions: (period: string, provider: string, range?: DateRange) => invoke('codeburn:getSessions', period, provider, range),
  getCompareModels: (period: string, provider: string) => invoke('codeburn:getCompareModels', period, provider),
  getCompare: (period: string, provider: string, modelA: string, modelB: string) => invoke('codeburn:getCompare', period, provider, modelA, modelB),
  getYield: (period: string, provider: string, range?: DateRange) => invoke('codeburn:getYield', period, provider, range),
  getSpendFlow: (period: string, provider: string, range?: DateRange) => invoke('codeburn:getSpendFlow', period, provider, range),
  getOptimizeReport: (period: string, provider: string, range?: DateRange) => invoke('codeburn:getOptimizeReport', period, provider, range),
  getDevices: (period: string) => invoke('codeburn:getDevices', period),
  getDevicesScan: () => invoke('codeburn:getDevicesScan'),
  getShareStatus: () => invoke('codeburn:getShareStatus'),
  getIdentity: () => invoke('codeburn:getIdentity'),
  getAliases: () => invoke('codeburn:getAliases'),
  getProxyPaths: () => invoke('codeburn:getProxyPaths'),
  getAudit: (period: string, provider: string, range?: DateRange) => invoke('codeburn:getAudit', period, provider, range),
  getPriceOverrides: () => invoke('codeburn:getPriceOverrides'),
  setPriceOverride: (model: string, rates: PriceRates) => invoke('codeburn:setPriceOverride', model, rates),
  removePriceOverride: (model: string) => invoke('codeburn:removePriceOverride', model),
  setCurrency: (code: string) => invoke('codeburn:setCurrency', code),
  resetCurrency: () => invoke('codeburn:resetCurrency'),
  addAlias: (from: string, to: string) => invoke('codeburn:addAlias', from, to),
  removeAlias: (from: string) => invoke('codeburn:removeAlias', from),
  removeDevice: (name: string) => invoke('codeburn:removeDevice', name),
  setPlan: (id: string, provider: string) => invoke('codeburn:setPlan', id, provider),
  resetPlan: (provider: string) => invoke('codeburn:resetPlan', provider),
  exportData: (format: string, provider: string, outPath: string) => invoke('codeburn:exportData', format, provider, outPath),
  chooseDirectory: () => invoke('codeburn:chooseDirectory'),
  cliStatus: () => invoke('codeburn:cliStatus'),

  // Qovrion performs no product telemetry. These compatibility methods settle
  // locally and never cross IPC, so renderer code cannot accidentally reactivate
  // inherited telemetry by calling old bridge methods.
  telemetryStatus: async () => null,
  setTelemetryEnabled: async (_enabled: boolean) => null,
  completeOnboarding: async (_enabled: boolean) => null,
  telemetryTrack: async (_name: string, _props?: Record<string, unknown>) => true,

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onProgress: (cb: (event: unknown) => void) => {
    const listener = (_event: unknown, event: unknown) => cb(event)
    ipcRenderer.on('codeburn:progress', listener)
    return () => { ipcRenderer.removeListener('codeburn:progress', listener) }
  },

  // The main-process checker is also no-network until Qovrion publishes a
  // verified release channel. Preserve the compatibility event shape for now.
  getUpdateStatus: () => invoke('codeburn:getUpdateStatus'),
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => cb(status)
    ipcRenderer.on('codeburn:update', listener)
    return () => { ipcRenderer.removeListener('codeburn:update', listener) }
  },
  platform: process.platform,
  arch: process.arch,
}

contextBridge.exposeInMainWorld('codeburn', bridge)
