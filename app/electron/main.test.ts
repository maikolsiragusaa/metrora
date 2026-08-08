// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'

// Stub electron so importing main.ts does not require an Electron runtime.
vi.mock('electron', () => ({
  app: { name: 'Metrora', whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: () => {} },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: () => {} },
  shell: { openExternal: vi.fn() },
}))

import { createApplicationMenuTemplate, createBeforeQuitHandler, createBridgeHandlers } from './main'
import { CliError } from './cli'
import { Telemetry } from './telemetry'

function fakeSpawn(result: unknown = { current: { cost: 12.34 } }) {
  const calls: string[][] = []
  const spawnCli = vi.fn(async (args: string[]) => {
    calls.push(args)
    return result
  })
  const spawnCliAction = vi.fn(async (args: string[]) => {
    calls.push(args)
    return { ok: true, stdout: 'updated', stderr: '', code: 0 }
  })
  return { spawnCli, spawnCliAction, calls }
}

// Every metrora:* channel with a representative arg tuple → the exact argv it
// must spawn. cliStatus is the one channel that resolves without spawning.
const CHANNELS = [
  'metrora:getOverview',
  'metrora:getQuota',
  'metrora:getPlans',
  'metrora:getActReport',
  'metrora:getModels',
  'metrora:getSessions',
  'metrora:getCompareModels',
  'metrora:getCompare',
  'metrora:getYield',
  'metrora:getSpendFlow',
  'metrora:getOptimizeReport',
  'metrora:getDevices',
  'metrora:getDevicesScan',
  'metrora:getShareStatus',
  'metrora:getIdentity',
  'metrora:getAliases',
  'metrora:getProxyPaths',
  'metrora:getAudit',
  'metrora:getPriceOverrides',
  'metrora:setCurrency',
  'metrora:resetCurrency',
  'metrora:addAlias',
  'metrora:removeAlias',
  'metrora:setPriceOverride',
  'metrora:removePriceOverride',
  'metrora:removeDevice',
  'metrora:setPlan',
  'metrora:resetPlan',
  'metrora:exportData',
  'metrora:cliStatus',
  'metrora:telemetryStatus',
  'metrora:telemetrySetEnabled',
  'metrora:telemetryOnboarded',
  'metrora:telemetryTrack',
  'metrora:getUpdateStatus',
] as const

const ARGV_CASES: Array<{ channel: string; args: unknown[]; argv: string[] }> = [
  { channel: 'metrora:getOverview', args: ['30days', 'claude'], argv: ['status', '--format', 'menubar-json', '--period', '30days', '--no-timeline', '--provider', 'claude'] },
  { channel: 'metrora:getOverview', args: ['30days', 'all'], argv: ['status', '--format', 'menubar-json', '--period', '30days', '--no-timeline'] },
  { channel: 'metrora:getPlans', args: ['week'], argv: ['status', '--format', 'json', '--period', 'week'] },
  { channel: 'metrora:getActReport', args: [], argv: ['act', 'report', '--json'] },
  { channel: 'metrora:getModels', args: ['week', 'claude', true], argv: ['models', '--format', 'json', '--period', 'week', '--provider', 'claude', '--by-task'] },
  { channel: 'metrora:getModels', args: ['week', 'all', false], argv: ['models', '--format', 'json', '--period', 'week'] },
  { channel: 'metrora:getSessions', args: ['week', 'all'], argv: ['sessions', '--format', 'json', '--period', 'week'] },
  { channel: 'metrora:getSessions', args: ['30days', 'claude', { from: '2026-07-01', to: '2026-07-11' }], argv: ['sessions', '--format', 'json', '--period', '30days', '--provider', 'claude', '--from', '2026-07-01', '--to', '2026-07-11'] },
  { channel: 'metrora:getCompareModels', args: ['month', 'codex'], argv: ['compare', '--format', 'json', '--period', 'month', '--provider', 'codex'] },
  { channel: 'metrora:getCompare', args: ['month', 'all', 'model-a', 'model-b'], argv: ['compare', '--format', 'json', '--period', 'month', '--model-a', 'model-a', '--model-b', 'model-b'] },
  { channel: 'metrora:getYield', args: ['today', 'all'], argv: ['yield', '--format', 'json', '--period', 'today'] },
  { channel: 'metrora:getYield', args: ['today', 'claude'], argv: ['yield', '--format', 'json', '--period', 'today', '--provider', 'claude'] },
  { channel: 'metrora:getSpendFlow', args: ['month', 'openai'], argv: ['spend', '--format', 'flow-json', '--period', 'month', '--provider', 'openai'] },
  { channel: 'metrora:getOptimizeReport', args: ['month', 'openai'], argv: ['optimize', '--format', 'json', '--period', 'month', '--provider', 'openai'] },
  { channel: 'metrora:getOverview', args: ['30days', 'all', { from: '2026-07-01', to: '2026-07-11' }], argv: ['status', '--format', 'menubar-json', '--period', '30days', '--no-timeline', '--from', '2026-07-01', '--to', '2026-07-11'] },
  { channel: 'metrora:getOverview', args: ['30days', 'all', undefined, 'claude-config:91dda17e8cf35193'], argv: ['status', '--format', 'menubar-json', '--period', '30days', '--no-timeline', '--claude-config-source', 'claude-config:91dda17e8cf35193'] },
  { channel: 'metrora:getOverview', args: ['month', 'claude', { from: '2026-07-01', to: '2026-07-11' }, 'claude-desktop:980e1e488a654830'], argv: ['status', '--format', 'menubar-json', '--period', 'month', '--no-timeline', '--provider', 'claude', '--from', '2026-07-01', '--to', '2026-07-11', '--claude-config-source', 'claude-desktop:980e1e488a654830'] },
  { channel: 'metrora:getModels', args: ['week', 'claude', true, { from: '2026-07-01', to: '2026-07-11' }], argv: ['models', '--format', 'json', '--period', 'week', '--provider', 'claude', '--by-task', '--from', '2026-07-01', '--to', '2026-07-11'] },
  { channel: 'metrora:getYield', args: ['today', 'all', { from: '2026-07-01', to: '2026-07-11' }], argv: ['yield', '--format', 'json', '--period', 'today', '--from', '2026-07-01', '--to', '2026-07-11'] },
  { channel: 'metrora:getSpendFlow', args: ['month', 'all', { from: '2026-07-01', to: '2026-07-11' }], argv: ['spend', '--format', 'flow-json', '--period', 'month', '--from', '2026-07-01', '--to', '2026-07-11'] },
  { channel: 'metrora:getOptimizeReport', args: ['month', 'all', { from: '2026-07-01', to: '2026-07-11' }], argv: ['optimize', '--format', 'json', '--period', 'month', '--from', '2026-07-01', '--to', '2026-07-11'] },
  { channel: 'metrora:getDevices', args: ['week'], argv: ['devices', '--format', 'json', '--period', 'week'] },
  { channel: 'metrora:getDevicesScan', args: [], argv: ['devices', 'scan', '--format', 'json'] },
  { channel: 'metrora:getShareStatus', args: [], argv: ['share', 'status', '--format', 'json'] },
  { channel: 'metrora:getIdentity', args: [], argv: ['identity', '--format', 'json'] },
  { channel: 'metrora:getAliases', args: [], argv: ['model-alias', '--list', '--format', 'json'] },
  { channel: 'metrora:getProxyPaths', args: [], argv: ['proxy-path', '--list', '--format', 'json'] },
  { channel: 'metrora:getAudit', args: ['month', 'claude'], argv: ['audit', '--format', 'json', '--period', 'month', '--provider', 'claude'] },
  { channel: 'metrora:getAudit', args: ['30days', 'all', { from: '2026-07-01', to: '2026-07-11' }], argv: ['audit', '--format', 'json', '--period', '30days', '--from', '2026-07-01', '--to', '2026-07-11'] },
  { channel: 'metrora:getPriceOverrides', args: [], argv: ['price-override', '--list', '--format', 'json'] },
  { channel: 'metrora:setPriceOverride', args: ['unpriced/test-model', { input: 0.27, output: 1.1 }], argv: ['price-override', 'unpriced/test-model', '--input', '0.27', '--output', '1.1'] },
  { channel: 'metrora:setPriceOverride', args: ['unpriced/test-model', { input: 0.27, output: 1.1, cacheRead: 0.03, cacheCreation: 0.42 }], argv: ['price-override', 'unpriced/test-model', '--input', '0.27', '--output', '1.1', '--cache-read', '0.03', '--cache-creation', '0.42'] },
  { channel: 'metrora:removePriceOverride', args: ['unpriced/test-model'], argv: ['price-override', '--remove', 'unpriced/test-model'] },
  { channel: 'metrora:setCurrency', args: ['EUR'], argv: ['currency', 'EUR'] },
  { channel: 'metrora:resetCurrency', args: [], argv: ['currency', '--reset'] },
  { channel: 'metrora:addAlias', args: ['unknown-model', 'priced-model'], argv: ['model-alias', 'unknown-model', 'priced-model'] },
  { channel: 'metrora:removeAlias', args: ['unknown-model'], argv: ['model-alias', '--remove', 'unknown-model'] },
  { channel: 'metrora:removeDevice', args: ['studio-mac'], argv: ['devices', 'rm', 'studio-mac'] },
  { channel: 'metrora:setPlan', args: ['claude-max', 'claude'], argv: ['plan', 'set', 'claude-max', '--provider', 'claude'] },
  { channel: 'metrora:resetPlan', args: ['cursor'], argv: ['plan', 'reset', '--provider', 'cursor'] },
  { channel: 'metrora:exportData', args: ['json', 'all', '/tmp/metrora-export'], argv: ['export', '-f', 'json', '-o', '/tmp/metrora-export', '--provider', 'all'] },
]

function flattenMenuItems(items: any[]): any[] {
  return items.flatMap(item => {
    const submenu = Array.isArray(item.submenu) ? flattenMenuItems(item.submenu) : []
    return [item, ...submenu]
  })
}

describe('createBridgeHandlers (channel → argv for all channels)', () => {
  const deps = (extra = {}) => ({ spawnCli: vi.fn(), spawnCliAction: vi.fn(), resolveMetroraPath: () => null, getQuota: vi.fn(async () => []), ...extra })
  it('exposes exactly the bridge channels', () => {
    const handlers = createBridgeHandlers(deps())
    expect(Object.keys(handlers).sort()).toEqual([...CHANNELS].sort())
  })

  it.each(ARGV_CASES)('$channel with $args spawns the expected argv', async ({ channel, args, argv }) => {
    const { spawnCli, spawnCliAction, calls } = fakeSpawn()
    const handlers = createBridgeHandlers(deps({ spawnCli, spawnCliAction, resolveMetroraPath: () => '/bin/metrora' }))
    const res = await handlers[channel]!(...args)
    expect(calls[0]).toEqual(argv)
    expect(res).toMatchObject({ ok: true })
  })

  it('metrora:cliStatus resolves from resolveMetroraPath without spawning', async () => {
    const spawnCli = vi.fn()
    const handlers = createBridgeHandlers(deps({ spawnCli, resolveMetroraPath: () => '/opt/homebrew/bin/metrora' }))
    const res = await handlers['metrora:cliStatus']!()
    expect(spawnCli).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: true, value: { found: true, path: '/opt/homebrew/bin/metrora' } })
  })
})

describe('createBridgeHandlers (IPC wiring)', () => {
  const withQuota = <T extends object>(value: T) => ({ ...value, getQuota: vi.fn(async () => []) })
  it('returns normalized quota through its own IPC channel and sanitizes unexpected failures', async () => {
    const base = { spawnCli: vi.fn(), spawnCliAction: vi.fn(), resolveMetroraPath: () => null }
    const value = [{ provider: 'claude' as const, connection: 'connected' as const, primary: null, details: [], planLabel: 'Pro', footerLines: [] }]
    const ok = createBridgeHandlers({ ...base, getQuota: vi.fn(async () => value) })
    expect(await ok['metrora:getQuota']!()).toEqual({ ok: true, value })

    const failed = createBridgeHandlers({ ...base, getQuota: vi.fn(async () => { throw new Error('Bearer secret sk-ant-leak') }) })
    const result = await failed['metrora:getQuota']!()
    expect(result).toMatchObject({ ok: false, error: { kind: 'nonzero' } })
    expect(JSON.stringify(result)).not.toMatch(/secret|sk-ant-leak/)
  })
  it('getOverview spawns menubar-json for the period, omitting --provider for "all"', async () => {
    const { spawnCli, spawnCliAction, calls } = fakeSpawn()
    const handlers = createBridgeHandlers(withQuota({ spawnCli, spawnCliAction, resolveMetroraPath: () => '/bin/metrora' }))
    const res = await handlers['metrora:getOverview']!('30days', 'all')
    expect(calls[0]).toEqual(['status', '--format', 'menubar-json', '--period', '30days', '--no-timeline'])
    expect(res).toEqual({ ok: true, value: { current: { cost: 12.34 } } })
  })

  it('adds --provider and --by-task when requested', async () => {
    const { spawnCli, spawnCliAction, calls } = fakeSpawn([])
    const handlers = createBridgeHandlers(withQuota({ spawnCli, spawnCliAction, resolveMetroraPath: () => null }))
    await handlers['metrora:getModels']!('week', 'claude', true)
    expect(calls[0]).toEqual(['models', '--format', 'json', '--period', 'week', '--provider', 'claude', '--by-task'])
  })

  it('returns an error envelope carrying the CliError kind', async () => {
    const spawnCli = vi.fn(async () => {
      throw new CliError('nonzero', 'boom')
    })
    const handlers = createBridgeHandlers(withQuota({ spawnCli, spawnCliAction: vi.fn(), resolveMetroraPath: () => '/bin/metrora' }))
    const res = await handlers['metrora:getYield']!('today', 'all')
    expect(res).toEqual({ ok: false, error: { kind: 'nonzero', message: 'boom' } })
  })

  it('cliStatus reports the resolved binary path', async () => {
    const handlers = createBridgeHandlers(withQuota({
      spawnCli: vi.fn(),
      spawnCliAction: vi.fn(),
      resolveMetroraPath: () => '/opt/homebrew/bin/metrora',
    }))
    const res = await handlers['metrora:cliStatus']!()
    expect(res).toEqual({ ok: true, value: { found: true, path: '/opt/homebrew/bin/metrora' } })
  })
})

describe('createBridgeHandlers (IPC input validation)', () => {
  const withQuota = <T extends object>(value: T) => ({ ...value, getQuota: vi.fn(async () => []) })
  const REJECTIONS: Array<{ name: string; channel: string; args: unknown[] }> = [
    { name: 'unknown period', channel: 'metrora:getOverview', args: ['yesterday', 'all'] },
    { name: 'provider with shell metacharacters', channel: 'metrora:getOverview', args: ['30days', 'claude; rm -rf'] },
    { name: 'uppercase provider', channel: 'metrora:getModels', args: ['week', 'Claude', false] },
    { name: 'malformed date range', channel: 'metrora:getYield', args: ['today', 'all', { from: '2026/07/01', to: '2026-07-11' }] },
    { name: 'lowercase currency code', channel: 'metrora:setCurrency', args: ['eur'] },
    { name: 'alias token that looks like a flag', channel: 'metrora:addAlias', args: ['--evil', 'safe'] },
    { name: 'device name that looks like a flag', channel: 'metrora:removeDevice', args: ['-rf'] },
    { name: 'relative export path', channel: 'metrora:exportData', args: ['json', 'all', 'relative/out'] },
    { name: 'compare model that looks like a flag', channel: 'metrora:getCompare', args: ['month', 'all', '-a', 'model-b'] },
    { name: 'price override model that looks like a flag', channel: 'metrora:setPriceOverride', args: ['-x', { input: 1, output: 2 }] },
    { name: 'non-positive price override rate', channel: 'metrora:setPriceOverride', args: ['my-model', { input: 0, output: 2 }] },
    { name: 'non-finite price override rate', channel: 'metrora:setPriceOverride', args: ['my-model', { input: 1, output: Number.POSITIVE_INFINITY }] },
    { name: 'remove price override model that looks like a flag', channel: 'metrora:removePriceOverride', args: ['--all'] },
    { name: 'claude config source that looks like a flag', channel: 'metrora:getOverview', args: ['30days', 'all', undefined, '-rf'] },
    { name: 'claude config source with shell metacharacters', channel: 'metrora:getOverview', args: ['30days', 'all', undefined, 'id; rm -rf'] },
  ]

  it.each(REJECTIONS)('rejects $name with a bad-args envelope and never spawns', async ({ channel, args }) => {
    const { spawnCli, spawnCliAction } = fakeSpawn()
    const handlers = createBridgeHandlers(withQuota({ spawnCli, spawnCliAction, resolveMetroraPath: () => '/bin/metrora' }))
    const res = await handlers[channel]!(...args)
    expect(res).toMatchObject({ ok: false, error: { kind: 'bad-args' } })
    expect(spawnCli).not.toHaveBeenCalled()
    expect(spawnCliAction).not.toHaveBeenCalled()
  })

  it('still accepts the valid values those cases mutate', async () => {
    const { spawnCli, spawnCliAction, calls } = fakeSpawn()
    const handlers = createBridgeHandlers(withQuota({ spawnCli, spawnCliAction, resolveMetroraPath: () => '/bin/metrora' }))
    await handlers['metrora:exportData']!('json', 'all', '/tmp/out')
    expect(calls[0]).toEqual(['export', '-f', 'json', '-o', '/tmp/out', '--provider', 'all'])
  })
})

describe('createBridgeHandlers (quota force + redaction)', () => {
  it('threads the renderer force flag into getQuota', async () => {
    const base = { spawnCli: vi.fn(), spawnCliAction: vi.fn(), resolveMetroraPath: () => null }
    const getQuota = vi.fn(async () => [])
    const handlers = createBridgeHandlers({ ...base, getQuota })
    await handlers['metrora:getQuota']!(true)
    expect(getQuota).toHaveBeenLastCalledWith({ force: true })
    await handlers['metrora:getQuota']!()
    expect(getQuota).toHaveBeenLastCalledWith({ force: false })
  })

  it('redacts secrets in ActionResult.stderr before it crosses IPC', async () => {
    const spawnCliAction = vi.fn(async () => ({ ok: false, stdout: '', stderr: 'auth failed: Bearer sk-ant-leak12345', code: 1 }))
    const handlers = createBridgeHandlers({ spawnCli: vi.fn(), spawnCliAction, resolveMetroraPath: () => '/bin/metrora', getQuota: vi.fn(async () => []) })
    const res = await handlers['metrora:setCurrency']!('EUR') as { ok: true; value: { stderr: string } }
    expect(res.ok).toBe(true)
    expect(res.value.stderr).not.toMatch(/sk-ant-leak|Bearer sk-ant/)
    expect(res.value.stderr).toContain('[REDACTED]')
  })
})

describe('createApplicationMenuTemplate', () => {
  it('keeps normal app roles while leaving CmdOrCtrl+R for renderer refresh', () => {
    const items = flattenMenuItems(createApplicationMenuTemplate(false))
    const roles = items.map(item => item.role).filter(Boolean)
    const accelerators = items.map(item => item.accelerator).filter(Boolean)

    expect(roles).toContain('copy')
    expect(roles).toContain('paste')
    expect(roles).toContain('quit')
    expect(roles).toContain('minimize')
    expect(roles).toContain('close')
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forceReload')
    expect(accelerators).not.toContain('CmdOrCtrl+R')
    expect(accelerators).not.toContain('CommandOrControl+R')
  })

  it('keeps DevTools available in dev without adding reload menu items', () => {
    const roles = flattenMenuItems(createApplicationMenuTemplate(true)).map(item => item.role).filter(Boolean)

    expect(roles).toContain('toggleDevTools')
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forceReload')
  })
})

describe('createBeforeQuitHandler', () => {
  it('cleans up and quits without sending an app-close request', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'metrora-main-quit-'))
    try {
      const fetchFn = vi.fn(async () => ({ ok: true } as Response)) as unknown as typeof fetch
      const telemetry = new Telemetry({ stateDir, country: 'US', isPackaged: true, appVersion: '1', fetchFn })

      const quit = vi.fn()
      const killChildren = vi.fn()
      const handler = createBeforeQuitHandler({ getTelemetry: () => telemetry, killAll: killChildren, quit })
      const firstEvent = { preventDefault: vi.fn() }
      handler(firstEvent)

      expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
      await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
      expect(killChildren).toHaveBeenCalledOnce()
      expect(fetchFn).not.toHaveBeenCalled()
      expect(telemetry.queueLength).toBe(0)

      const finalEvent = { preventDefault: vi.fn() }
      handler(finalEvent)
      expect(finalEvent.preventDefault).not.toHaveBeenCalled()
      expect(quit).toHaveBeenCalledOnce()
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it('allows quit at 1500ms when the endpoint never resolves and does not re-enter', async () => {
    vi.useFakeTimers()
    try {
      const trackClose = vi.fn()
      const flush = vi.fn(() => new Promise<boolean>(() => {}))
      const quit = vi.fn()
      const handler = createBeforeQuitHandler({
        getTelemetry: () => ({ trackClose, flush }),
        killAll: vi.fn(),
        quit,
      })

      const firstEvent = { preventDefault: vi.fn() }
      handler(firstEvent)
      const repeatedEvent = { preventDefault: vi.fn() }
      handler(repeatedEvent)

      expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
      expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
      expect(trackClose).toHaveBeenCalledOnce()
      expect(flush).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(1499)
      expect(quit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(quit).toHaveBeenCalledOnce()

      const finalEvent = { preventDefault: vi.fn() }
      handler(finalEvent)
      expect(finalEvent.preventDefault).not.toHaveBeenCalled()
      expect(quit).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still flushes and quits when trackClose throws synchronously', async () => {
    const trackClose = vi.fn(() => { throw new Error('track close failed') })
    const flush = vi.fn(async () => true)
    const quit = vi.fn()
    const handler = createBeforeQuitHandler({
      getTelemetry: () => ({ trackClose, flush }),
      killAll: vi.fn(),
      quit,
    })

    handler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
    expect(trackClose).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('still quits when synchronous child cleanup throws', async () => {
    const quit = vi.fn()
    const handler = createBeforeQuitHandler({
      getTelemetry: () => null,
      killAll: () => { throw new Error('child cleanup failed') },
      quit,
    })

    handler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
  })

  it('still quits when synchronous telemetry lookup throws', async () => {
    const quit = vi.fn()
    const handler = createBeforeQuitHandler({
      getTelemetry: () => { throw new Error('telemetry lookup failed') },
      killAll: vi.fn(),
      quit,
    })

    handler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
  })

  it('does not wait for the timeout when telemetry cannot send yet', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'cb-main-no-consent-'))
    try {
      const fetchFn = vi.fn() as unknown as typeof fetch
      const telemetry = new Telemetry({ stateDir, country: 'US', isPackaged: true, appVersion: '1', fetchFn })
      const quit = vi.fn()
      const handler = createBeforeQuitHandler({ getTelemetry: () => telemetry, killAll: vi.fn(), quit })

      handler({ preventDefault: vi.fn() })
      await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
      expect(fetchFn).not.toHaveBeenCalled()
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})

describe('createBridgeHandlers (cold-start warmup)', () => {
  const base = (extra: object) => ({ spawnCli: vi.fn(), spawnCliAction: vi.fn(), resolveMetroraPath: () => '/bin/metrora', getQuota: vi.fn(async () => []), ...extra })

  it('gives the first overview a long timeout + progress env, then reverts once warmed', async () => {
    const opts: Array<Record<string, unknown> | undefined> = []
    const spawnCli = vi.fn(async (_args: string[], o?: Record<string, unknown>) => { opts.push(o); return { current: { cost: 1 } } })
    const emitProgress = vi.fn()
    const handlers = createBridgeHandlers(base({ spawnCli, emitProgress }))

    await handlers['metrora:getOverview']!('30days', 'all')
    expect(opts[0]?.timeoutMs).toBe(10 * 60_000)
    expect((opts[0]?.extraEnv as Record<string, string> | undefined)?.METRORA_PROGRESS).toBe('1')
    expect(typeof opts[0]?.onStderr).toBe('function')
    expect(emitProgress).toHaveBeenCalledWith({ kind: 'done' })

    await handlers['metrora:getOverview']!('30days', 'all')
    expect(opts[1]?.timeoutMs).toBeUndefined()
    expect(opts[1]?.extraEnv).toBeUndefined()
  })

  it('drops a warmed overview to background priority only when the prefetch flag is set', async () => {
    const opts: Array<Record<string, unknown> | undefined> = []
    const spawnCli = vi.fn(async (_args: string[], o?: Record<string, unknown>) => { opts.push(o); return { current: { cost: 1 } } })
    const handlers = createBridgeHandlers(base({ spawnCli, emitProgress: vi.fn() }))

    await handlers['metrora:getOverview']!('30days', 'all') // cold warmup → interactive
    await handlers['metrora:getOverview']!('30days', 'claude') // warmed, no flag → interactive
    await handlers['metrora:getOverview']!('30days', 'grok', undefined, null, true) // prefetch → background

    expect(opts[0]?.priority).toBeUndefined()
    expect(opts[1]?.priority).toBeUndefined()
    expect(opts[2]?.priority).toBe('background')
  })

  it('re-arms the long timeout when the first overview fails (cache is still cold)', async () => {
    const opts: Array<{ timeoutMs?: number } | undefined> = []
    let n = 0
    const spawnCli = vi.fn(async (_args: string[], o?: { timeoutMs?: number }) => {
      opts.push(o)
      if (++n === 1) throw new CliError('timeout', 'timed out')
      return { current: { cost: 1 } }
    })
    const handlers = createBridgeHandlers(base({ spawnCli, emitProgress: vi.fn() }))

    expect(await handlers['metrora:getOverview']!('30days', 'all')).toMatchObject({ ok: false })
    expect(await handlers['metrora:getOverview']!('30days', 'all')).toMatchObject({ ok: true })
    expect(opts[0]?.timeoutMs).toBe(10 * 60_000)
    expect(opts[1]?.timeoutMs).toBe(10 * 60_000)
  })

  it('parses CLI scan-progress stderr lines and forwards them to emitProgress', async () => {
    const spawnCli = vi.fn(async (_args: string[], o?: { onStderr?: (chunk: string) => void }) => {
      // A split line proves the reader buffers across chunks.
      o?.onStderr?.('METRORA_PROGRESS {"kind":"providers","providers":["claude","codex"]}\nMETRORA_PROG')
      o?.onStderr?.('RESS {"kind":"tick","provider":"claude","done":5,"total":10}\nnoise line\n')
      return { current: { cost: 1 } }
    })
    const emitProgress = vi.fn()
    const handlers = createBridgeHandlers(base({ spawnCli, emitProgress }))
    await handlers['metrora:getOverview']!('30days', 'all')

    expect(emitProgress).toHaveBeenCalledWith({ kind: 'providers', providers: ['claude', 'codex'] })
    expect(emitProgress).toHaveBeenCalledWith({ kind: 'tick', provider: 'claude', done: 5, total: 10 })
  })
})

describe('createBridgeHandlers (telemetry wiring)', () => {
  const fakeTelemetry = () => ({
    status: vi.fn(() => ({ installId: 'id-1', country: 'US', enabled: true, defaultEnabled: true, onboarded: false })),
    setEnabled: vi.fn((enabled: boolean) => ({ installId: 'id-2', country: 'US', enabled, defaultEnabled: true, onboarded: false })),
    completeOnboarding: vi.fn((enabled: boolean) => ({ installId: 'id-1', country: 'US', enabled, defaultEnabled: true, onboarded: true })),
    track: vi.fn(),
  })
  const deps = (telemetry: ReturnType<typeof fakeTelemetry> | null) => ({
    spawnCli: vi.fn(async () => ({ current: { cost: 1 } })),
    spawnCliAction: vi.fn(),
    resolveMetroraPath: () => '/bin/metrora',
    getQuota: vi.fn(async () => []),
    emitProgress: vi.fn(),
    telemetry,
  })

  it('exposes status/consent/track channels and forwards to the telemetry service', async () => {
    const telemetry = fakeTelemetry()
    const handlers = createBridgeHandlers(deps(telemetry))

    expect(await handlers['metrora:telemetryStatus']!()).toMatchObject({ ok: true, value: { installId: 'id-1', onboarded: false } })
    expect(await handlers['metrora:telemetrySetEnabled']!(false)).toMatchObject({ ok: true, value: { enabled: false } })
    expect(telemetry.setEnabled).toHaveBeenCalledWith(false)
    expect(await handlers['metrora:telemetryOnboarded']!(true)).toMatchObject({ ok: true, value: { onboarded: true } })
    expect(telemetry.completeOnboarding).toHaveBeenCalledWith(true)
    await handlers['metrora:telemetryTrack']!('section_view', { section: 'spend' })
    expect(telemetry.track).toHaveBeenCalledWith('section_view', { section: 'spend' })
  })

  it('returns null (not an error) when telemetry is unavailable', async () => {
    const handlers = createBridgeHandlers(deps(null))
    expect(await handlers['metrora:telemetryStatus']!()).toEqual({ ok: true, value: null })
    expect(await handlers['metrora:telemetryTrack']!('section_view', {})).toEqual({ ok: true, value: true })
  })

  it('tracks cold_start once on the first overview success, with duration', async () => {
    const telemetry = fakeTelemetry()
    const handlers = createBridgeHandlers(deps(telemetry))
    await handlers['metrora:getOverview']!('30days', 'all')
    await handlers['metrora:getOverview']!('30days', 'all')
    const coldStarts = telemetry.track.mock.calls.filter(([name]) => name === 'cold_start')
    expect(coldStarts.length).toBe(1)
    expect(coldStarts[0]![1]).toMatchObject({ timedOut: false })
    expect(typeof (coldStarts[0]![1] as { ms: number }).ms).toBe('number')
  })

  it('records cold_start exactly once across coalesced re-polls, with the first-attempt duration (no cumulative ladder)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const telemetry = fakeTelemetry()
      // Coalescing: every same-arg cold re-poll joins the ONE in-flight child.
      let release!: (v: unknown) => void
      const shared = new Promise(res => { release = res })
      const spawnCli = vi.fn(() => shared)
      const handlers = createBridgeHandlers({ ...deps(telemetry), spawnCli })

      const p1 = handlers['metrora:getOverview']!('30days', 'all') // anchors cold clock at t=0
      vi.setSystemTime(30_000)
      const p2 = handlers['metrora:getOverview']!('30days', 'all')
      vi.setSystemTime(60_000)
      const p3 = handlers['metrora:getOverview']!('30days', 'all')

      // The stuck child finally settles ~102.8s after launch.
      vi.setSystemTime(102_801)
      release({ current: { cost: 1 } })
      await Promise.all([p1, p2, p3])

      const coldStarts = telemetry.track.mock.calls.filter(([name]) => name === 'cold_start')
      expect(coldStarts.length).toBe(1)
      // One row, first-attempt duration — not the old 42801→72800→102801 ladder.
      expect(coldStarts[0]![1]).toMatchObject({ ms: 102_801, timedOut: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('records cold_start with timedOut:true when the first (cold) overview attempt times out', async () => {
    const telemetry = fakeTelemetry()
    const spawnCli = vi.fn(async () => { throw new CliError('timeout', 'timed out') })
    const handlers = createBridgeHandlers({ ...deps(telemetry), spawnCli })
    await handlers['metrora:getOverview']!('30days', 'all')
    const coldStarts = telemetry.track.mock.calls.filter(([name]) => name === 'cold_start')
    expect(coldStarts.length).toBe(1)
    expect(coldStarts[0]![1]).toMatchObject({ timedOut: true })
  })

  it('does not re-emit cold_start on a warmup re-arm, keeping the first attempt timedOut:true', async () => {
    const telemetry = fakeTelemetry()
    let n = 0
    const spawnCli = vi.fn(async () => {
      if (++n === 1) throw new CliError('timeout', 'timed out') // first cold attempt: final timeout
      return { current: { cost: 1 } } // re-armed cold attempt succeeds
    })
    const handlers = createBridgeHandlers({ ...deps(telemetry), spawnCli })
    await handlers['metrora:getOverview']!('30days', 'all')
    await handlers['metrora:getOverview']!('30days', 'all')
    const coldStarts = telemetry.track.mock.calls.filter(([name]) => name === 'cold_start')
    expect(coldStarts.length).toBe(1)
    expect(coldStarts[0]![1]).toMatchObject({ timedOut: true })
  })

  it('tracks cli_error with the failing kind and the CLI subcommand (cmd = argv[0])', async () => {
    const telemetry = fakeTelemetry()
    const failing = {
      ...deps(telemetry),
      spawnCli: vi.fn(async () => { throw new CliError('timeout', 'timed out') }),
    }
    const handlers = createBridgeHandlers(failing)
    await handlers['metrora:getSessions']!('week', 'all')
    expect(telemetry.track).toHaveBeenCalledWith('cli_error', { cmd: 'sessions', kind: 'timeout' })
  })

  it('includes the resolution-stage detail for a not-found (self-diagnosing without a repro)', async () => {
    const telemetry = fakeTelemetry()
    const failing = {
      ...deps(telemetry),
      // Mirrors the Windows P0: bundled path present but rejected by the resolver.
      spawnCli: vi.fn(async () => { throw new CliError('not-found', 'metrora CLI not found', 'bundled-not-absolute') }),
    }
    const handlers = createBridgeHandlers(failing)
    await handlers['metrora:getPlans']!('week')
    expect(telemetry.track).toHaveBeenCalledWith('cli_error', { cmd: 'status', kind: 'not-found', detail: 'bundled-not-absolute' })
  })

  it('never leaks a path or message into cli_error telemetry, even when the error carries one', async () => {
    const telemetry = fakeTelemetry()
    const failing = {
      ...deps(telemetry),
      // A spawn-time ENOENT whose message embeds a filesystem path.
      spawnCli: vi.fn(async () => {
        throw new CliError('not-found', 'spawn C:\\Users\\alice\\secret\\metrora.exe ENOENT', 'spawn-error')
      }),
    }
    const handlers = createBridgeHandlers(failing)
    await handlers['metrora:getSessions']!('week', 'all')
    const props = telemetry.track.mock.calls.find(([name]) => name === 'cli_error')![1] as Record<string, unknown>
    expect(props).toEqual({ cmd: 'sessions', kind: 'not-found', detail: 'spawn-error' })
    expect(JSON.stringify(props)).not.toContain('secret')
    expect(JSON.stringify(props)).not.toContain('C:\\')
  })
})
