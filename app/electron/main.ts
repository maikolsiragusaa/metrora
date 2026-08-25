import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { CliError, resolveMetroraPath, shutdownCli, spawnCli, spawnCliAction, type ActionResult, type SpawnPriority } from './cli'
import type { TrustedProgressEvent } from './cli-watchdog'
import { createApplicationMenuTemplate } from './menu'
import { getQuota, sanitizeError } from './quota'
import { sanitizeQuotaProviders } from './quota/types'
import { createShareBridgeHandlers } from './share-bridge'
import { initializeDesktopShareRuntime, stopDesktopShareRuntime, type DesktopShareRuntime } from './share-runtime'
import { Telemetry } from './telemetry'
import { createUpdateChecker, type UpdateChecker, type UpdateStatus } from './updates'
import { createProjectBridgeHandlers, validateProjectScope } from './project-bridge'
import { createAdvisorRuntimeHandlers } from './advisor-runtime'
import { AdvisorCredentialStore, type AdvisorCredentialProvider } from './advisor-credentials'
import { createAdvisorHostedHandlers, type AdvisorHostedEvent } from './advisor-provider'

export { createApplicationMenuTemplate } from './menu'

// Initialized in bootstrap() once Electron paths exist; stays null under tests.
let telemetryInstance: Telemetry | null = null
// The once-per-launch + 24h update-availability checker. Null under tests.
let updateChecker: UpdateChecker | null = null

/** The slice of Telemetry the bridge handlers use — injectable for tests. */
export type TelemetryBridge = Pick<Telemetry, 'status' | 'setEnabled' | 'completeOnboarding' | 'track'>

type QuitTelemetry = Pick<Telemetry, 'trackClose' | 'flush'>
type BeforeQuitEvent = { preventDefault: () => void }
type BeforeQuitDeps = {
  getTelemetry: () => QuitTelemetry | null
  killAll: () => void
  stopShare?: () => Promise<unknown>
  quit: () => void
  timeoutMs?: number
}

const QUIT_FLUSH_TIMEOUT_MS = 1500

/** Intercept one quit pass, then allow the re-entrant pass after a bounded flush. */
export function createBeforeQuitHandler(deps: BeforeQuitDeps): (event: BeforeQuitEvent) => void {
  let flushStarted = false
  let allowQuit = false
  let closeTracked = false

  return event => {
    if (allowQuit) return
    try { event.preventDefault() } catch { /* keep the quit path moving */ }
    if (flushStarted) return
    flushStarted = true

    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        try { deps.killAll() } catch { /* child cleanup must not wedge quit */ }

        const stopShare = deps.stopShare ? Promise.resolve().then(deps.stopShare).catch(() => false) : Promise.resolve(false)

        let telemetry: QuitTelemetry | null = null
        try { telemetry = deps.getTelemetry() } catch { /* telemetry lookup is best-effort */ }

        let flush: Promise<unknown> = Promise.resolve(false)
        if (telemetry) {
          if (!closeTracked) {
            closeTracked = true
            try { telemetry.trackClose() } catch { /* flush the existing queue anyway */ }
          }
          try { flush = Promise.resolve(telemetry.flush()) } catch { /* use the resolved fallback */ }
        }

        const timeout = new Promise<void>(resolve => {
          timer = setTimeout(resolve, deps.timeoutMs ?? QUIT_FLUSH_TIMEOUT_MS)
        })
        await Promise.race([Promise.all([flush.catch(() => false), stopShare.catch(() => false)]), timeout])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        allowQuit = true
        try { deps.quit() } catch { /* a throwing quit call must not reset the guard */ }
      }
    })()
  }
}

// Result envelope: handlers never throw across IPC so the structured error
// `kind` survives contextBridge serialization. preload.ts unwraps it.
export type Envelope<T = unknown> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } }

// The first overview fetch after boot hydrates a cold cache from scratch (a full
// history parse). That can far exceed the 45s read timeout, and killing it means
// the cache never persists, so every later poll restarts the scan — perpetual
// slowness. Give the first (cold) overview a long window; revert to the default
// once it succeeds. Sections gate their own first poll on this one resolving so
// the cold hydration runs ONCE, not once per section in parallel.
const WARMUP_TIMEOUT_MS = 10 * 60_000
// A valid monotonic parser heartbeat may extend idle time, never this ceiling.
const PROGRESS_IDLE_TIMEOUT_MS = 45_000
// Wire marker for CLI scan-progress lines (src/parser.ts: PROGRESS_LINE_PREFIX).
const PROGRESS_LINE_PREFIX = 'METRORA_PROGRESS '
// IPC channel carrying cold-start scan-progress events to the splash.
export const PROGRESS_CHANNEL = 'metrora:progress'
// IPC channel pushing update-availability status to open windows (launch + 24h).
export const UPDATE_CHANNEL = 'metrora:update'

/** Line-buffer a spawn's stderr and forward each parsed scan-progress event. */
export function makeProgressReader(emit: (event: unknown) => void): (chunk: string) => void {
  let buffer = ''
  return chunk => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.startsWith(PROGRESS_LINE_PREFIX)) {
        try { emit(JSON.parse(line.slice(PROGRESS_LINE_PREFIX.length))) } catch { /* ignore malformed line */ }
      }
      nl = buffer.indexOf('\n')
    }
  }
}

function broadcastProgress(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(PROGRESS_CHANNEL, event)
  }
}

function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(UPDATE_CHANNEL, status)
  }
}

const NO_UPDATE_STATUS: UpdateStatus = { currentVersion: '', latestVersion: null, updateAvailable: false, tag: null }
export const ADVISOR_HOSTED_EVENT_CHANNEL = 'metrora:advisorHostedEvent'
type AdvisorHostedRendererEvent = Pick<AdvisorHostedEvent, 'requestId' | 'provider' | 'model' | 'kind' | 'usage' | 'streamed' | 'code'>
export function projectAdvisorHostedEvent(event: AdvisorHostedEvent): AdvisorHostedRendererEvent {
  return {
    requestId: event.requestId.slice(0, 120),
    provider: event.provider,
    model: event.model.replace(/[^A-Za-z0-9._:/-]/gu, '').slice(0, 160),
    kind: event.kind,
    ...(event.usage ? { usage: { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, totalTokens: event.usage.totalTokens } } : {}),
    ...(event.streamed !== undefined ? { streamed: event.streamed } : {}),
    ...(event.code ? { code: event.code.replace(/[^A-Za-z0-9._:-]/gu, '').slice(0, 80) } : {}),
  }
}
function broadcastAdvisorHostedEvent(event: AdvisorHostedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(ADVISOR_HOSTED_EVENT_CHANNEL, projectAdvisorHostedEvent(event))
  }
}

function providerArgs(provider: string | undefined): string[] {
  return provider && provider !== 'all' ? ['--provider', provider] : []
}

type DateRange = { from: string; to: string }

function rangeArgs(range: DateRange | undefined): string[] {
  return range ? ['--from', range.from, '--to', range.to] : []
}

function configSourceArgs(source: string | null): string[] {
  return source ? ['--claude-config-source', source] : []
}

// Renderer-supplied strings become argv, so reject anything that could smuggle a
// flag or shell metacharacter before it reaches the CLI. Thrown from the argv
// builders, these surface through the same error envelope as any CliError.
const PERIODS = new Set(['today', 'week', '30days', 'month', 'all', 'lifetime'])
function vPeriod(period: string): string {
  if (!PERIODS.has(period)) throw new CliError('bad-args', 'invalid period')
  return period
}
function vProvider(provider: string): string {
  if (!/^[a-z0-9-]+$/.test(provider)) throw new CliError('bad-args', 'invalid provider')
  return provider
}
function vRange(range: DateRange | undefined): DateRange | undefined {
  if (range && (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to))) {
    throw new CliError('bad-args', 'invalid date range')
  }
  return range
}
function vCurrency(code: string): string {
  if (!/^[A-Z]{3}$/.test(code)) throw new CliError('bad-args', 'invalid currency code')
  return code
}
/** model/alias/device/plan tokens: must not be read as a CLI flag. */
function vToken(value: string): string {
  if (value.startsWith('-')) throw new CliError('bad-args', 'argument must not start with "-"')
  return value
}
// Claude config source ids are `<kind>:<hex>` (src/providers/claude.ts) — the
// colon is part of the real value, so the token class allows it while anchoring
// the first char to alphanumeric so a leading "-" can never smuggle a flag.
function vConfigSource(source: string | null | undefined): string | null {
  if (source == null) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(source)) throw new CliError('bad-args', 'invalid claude config source')
  return source
}
function vOutPath(outPath: string): string {
  if (outPath.startsWith('-') || !path.isAbsolute(outPath)) throw new CliError('bad-args', 'export path must be absolute')
  return outPath
}
// Price-override rates are USD per 1M tokens: every provided rate must be a
// finite, strictly positive number before it becomes a CLI value.
type PriceRates = { input?: number; output?: number; cacheRead?: number; cacheCreation?: number }
function rateArg(flag: string, value: number | undefined): string[] {
  if (value === undefined) return []
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new CliError('bad-args', 'rate must be a positive number')
  return [flag, String(value)]
}
function priceOverrideArgs(model: string, rates: PriceRates | undefined): string[] {
  const r = rates ?? {}
  return [
    'price-override', vToken(model),
    ...rateArg('--input', r.input),
    ...rateArg('--output', r.output),
    ...rateArg('--cache-read', r.cacheRead),
    ...rateArg('--cache-creation', r.cacheCreation),
  ]
}

function toEnvelopeError(err: unknown): { kind: string; message: string } {
  if (err instanceof CliError) return { kind: err.kind, message: sanitizeError(err.message) }
  return { kind: 'nonzero', message: sanitizeError(err instanceof Error ? err.message : String(err)) }
}

/**
 * Props for a `cli_error` telemetry event. Deliberately carries only
 * non-sensitive enums so the event is diagnosable without a repro yet leaks
 * nothing: `cmd` is the CLI subcommand (argv[0], a fixed literal like 'status'/
 * 'sessions' — never the full args, which can hold paths), and `detail` is the
 * not-found resolution/spawn stage. The error's `message` (which may contain a
 * path or stderr) is never read here — only `kind` and the stage enum are.
 */
function cliErrorProps(err: unknown, cmd: string | undefined): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  if (cmd) props.cmd = cmd
  if (err instanceof CliError) {
    props.kind = err.kind
    if (err.kind === 'not-found' && err.detail) props.detail = err.detail
  } else {
    props.kind = 'nonzero'
  }
  return props
}

type Deps = {
  spawnCli: (args: string[], opts?: { timeoutMs?: number; idleTimeoutMs?: number; onStderr?: (chunk: string) => void; onProgress?: (event: TrustedProgressEvent) => void; extraEnv?: NodeJS.ProcessEnv; priority?: SpawnPriority }) => Promise<unknown>
  spawnCliAction: (args: string[], opts?: { timeoutMs?: number }) => Promise<ActionResult>
  resolveMetroraPath: () => string | null
  getQuota: typeof getQuota
  /** Forward cold-start scan-progress events to the renderer splash. */
  emitProgress?: (event: unknown) => void
  /** Consent-gated anonymous telemetry; absent under tests unless injected. */
  telemetry?: TelemetryBridge | null
  /** Cached update-availability status; absent under tests unless injected. */
  getUpdateStatus?: () => Promise<UpdateStatus>
  share?: DesktopShareRuntime | null
  advisorCredentials?: Pick<AdvisorCredentialStore, 'status' | 'set' | 'clear'>
  advisorHostedHandlers?: Record<string, Handler>
}

type Handler = (...args: any[]) => Promise<Envelope>

/**
 * Maps every MetroraBridge channel to its `metrora` argv (plain args, no
 * shell) and returns a result envelope. Pure + injectable so the wiring is
 * unit-testable without launching Electron.
 */
export function createBridgeHandlers(deps: Deps = { spawnCli, spawnCliAction, resolveMetroraPath, getQuota, emitProgress: broadcastProgress, telemetry: telemetryInstance, getUpdateStatus: () => updateChecker ? updateChecker.getStatus() : Promise.resolve(NO_UPDATE_STATUS) }): Record<string, Handler> {
  const snapshotEnv = { METRORA_READ_MODE: 'snapshot' }
  const emitProgress = deps.emitProgress ?? (() => {})
  const telemetry = deps.telemetry ?? null
  // Latch cold_start to the first coalesced attempt in this app process.
  let coldStartEmitted = false
  let coldStartBegan: number | null = null
  const emitColdStart = (timedOut: boolean): void => {
    if (coldStartEmitted) return
    coldStartEmitted = true
    telemetry?.track('cold_start', { ms: Date.now() - (coldStartBegan ?? Date.now()), timedOut })
  }

  const run = (build: (...args: any[]) => string[]): Handler => async (...args: any[]) => {
    let cmd: string | undefined
    try {
      const argv = build(...args)
      cmd = argv[0]
      return { ok: true, value: await deps.spawnCli(argv, { extraEnv: snapshotEnv }) }
    } catch (err) {
      const error = toEnvelopeError(err)
      telemetry?.track('cli_error', cliErrorProps(err, cmd))
      return { ok: false, error }
    }
  }

  // The desktop never renders the granular timeline, so it always passes
  // --no-timeline (skips buildGranularHistory on every poll). The Swift menubar
  // omits the flag and keeps the timeline unchanged.
  const buildOverviewArgs = (period: string, provider: string, range?: DateRange, configSource?: string | null, projectScopeId?: string | null): string[] => [
    'status', '--format', 'menubar-json', '--period', vPeriod(period), '--no-timeline',
    ...providerArgs(vProvider(provider)), ...rangeArgs(vRange(range)), ...configSourceArgs(vConfigSource(configSource)),
    ...(validateProjectScope(projectScopeId) ? ['--metrora-project', validateProjectScope(projectScopeId)!] : []),
  ]

  // `background` (renderer prefetch only) drops this fetch to background priority
  // so it yields the CLI's run slots to any interactive poll or click. Optional
  // and defaulting to interactive, so an older preload that omits it is unchanged.
  const getOverview: Handler = async (period: string, provider: string, range?: DateRange, configSource?: string | null, background?: boolean, fresh?: boolean, projectScopeId?: string | null) => {
    coldStartBegan ??= Date.now()
    const priority: SpawnPriority | undefined = background ? 'background' : undefined
    try {
      const args = buildOverviewArgs(period, provider, range, configSource, projectScopeId)
      const snapshot = !fresh && !configSource
      if (snapshot) {
        const value = await deps.spawnCli(args, { extraEnv: snapshotEnv, ...(priority ? { priority } : {}) })
        emitColdStart(false)
        return { ok: true, value }
      }
      const value = await deps.spawnCli(args, {
        timeoutMs: WARMUP_TIMEOUT_MS,
        idleTimeoutMs: PROGRESS_IDLE_TIMEOUT_MS,
        onProgress: () => {},
        extraEnv: { METRORA_PROGRESS: '1' },
        onStderr: makeProgressReader(emitProgress),
        ...(priority ? { priority } : {}),
      })
      emitProgress({ kind: 'done' })
      emitColdStart(false)
      return { ok: true, value }
    } catch (err) {
      const error = toEnvelopeError(err)
      emitColdStart(error.kind === 'timeout')
      telemetry?.track('cli_error', cliErrorProps(err, 'status'))
      return { ok: false, error }
    }
  }
  const runAction = (build: (...args: any[]) => string[]): Handler => async (...args: any[]) => {
    try {
      const result = await deps.spawnCliAction(build(...args))
      return { ok: true, value: { ...result, stderr: sanitizeError(result.stderr) } }
    } catch (err) {
      return { ok: false, error: toEnvelopeError(err) }
    }
  }

  const credentialProvider = (value: unknown): AdvisorCredentialProvider | null => {
    return value === 'openai' || value === 'anthropic' || value === 'gemini' ? value : null
  }
  const credentialStatus = async (value: unknown): Promise<Envelope> => {
    const provider = credentialProvider(value)
    if (!provider) return { ok: false, error: { kind: 'bad-args', message: 'invalid Advisor credential provider' } }
    if (!deps.advisorCredentials) return { ok: true, value: { provider, state: 'locked-unavailable' } }
    try { return { ok: true, value: await deps.advisorCredentials.status(provider) } }
    catch { return { ok: true, value: { provider, state: 'locked-unavailable' } } }
  }
  const credentialSet = async (value: unknown, secret: unknown): Promise<Envelope> => {
    const provider = credentialProvider(value)
    if (!provider) return { ok: false, error: { kind: 'bad-args', message: 'invalid Advisor credential provider' } }
    if (!deps.advisorCredentials) return { ok: true, value: { provider, state: 'locked-unavailable' } }
    if (typeof secret !== 'string' || secret.length === 0 || secret.length > 16 * 1024) return { ok: true, value: { provider, state: 'invalid' } }
    try { return { ok: true, value: await deps.advisorCredentials.set(provider, secret) } }
    catch { return { ok: true, value: { provider, state: 'needs-reentry' } } }
  }
  const credentialClear = async (value: unknown): Promise<Envelope> => {
    const provider = credentialProvider(value)
    if (!provider) return { ok: false, error: { kind: 'bad-args', message: 'invalid Advisor credential provider' } }
    if (!deps.advisorCredentials) return { ok: true, value: { provider, state: 'locked-unavailable' } }
    try { return { ok: true, value: await deps.advisorCredentials.clear(provider) } }
    catch { return { ok: true, value: { provider, state: 'needs-reentry' } } }
  }
  return {
    'metrora:getQuota': async (force?: boolean) => {
      try { return { ok: true, value: sanitizeQuotaProviders(await deps.getQuota({ force: Boolean(force) })) } }
      catch (error) { return { ok: false, error: { kind: 'nonzero', message: sanitizeError(error) } } }
    },
    'metrora:getOverview': getOverview,
    ...createProjectBridgeHandlers({ spawnCli: deps.spawnCli, spawnCliAction: deps.spawnCliAction, snapshotEnv }),
    ...createAdvisorRuntimeHandlers(),
    ...(deps.advisorHostedHandlers ?? {}),
    ...(deps.advisorCredentials ? {
      'metrora:advisorCredentialStatus': credentialStatus,
      'metrora:advisorCredentialSet': credentialSet,
      'metrora:advisorCredentialClear': credentialClear,
    } : {}),
    'metrora:getBenchHistory': run(() => ['bench', 'history', '--format', 'json', '--limit', '50']),
    'metrora:getBenchComparison': run((leftRunId: string, rightRunId: string) => ['bench', 'compare', vToken(leftRunId), vToken(rightRunId), '--format', 'json']),
    'metrora:runBenchTaskPack': async (model: string, pack = 'core-v1') => {
      try {
        const value = await deps.spawnCli(['bench', 'task-pack', '--model', vToken(model), '--pack', vToken(pack), '--format', 'json', '--run-id', randomUUID()], { timeoutMs: 10 * 60_000, extraEnv: snapshotEnv })
        return { ok: true, value }
      } catch (err) {
        return { ok: false, error: toEnvelopeError(err) }
      }
    },
    'metrora:getPlans': run((period: string) => ['status', '--format', 'json', '--period', vPeriod(period)]),
    'metrora:getActReport': run(() => ['act', 'report', '--json']),
    'metrora:getModels': run((period: string, provider: string, byTask: boolean, range?: DateRange, projectScopeId?: string | null) => [
      'models', '--format', 'json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)), ...(byTask ? ['--by-task'] : []), ...rangeArgs(vRange(range)),
      ...(validateProjectScope(projectScopeId) ? ['--metrora-project', validateProjectScope(projectScopeId)!] : []),
    ]),
    'metrora:getSessions': run((period: string, provider: string, range?: DateRange, projectScopeId?: string | null) => [
      'sessions', '--format', 'json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)), ...rangeArgs(vRange(range)),
      ...(validateProjectScope(projectScopeId) ? ['--metrora-project', validateProjectScope(projectScopeId)!] : []),
    ]),
    'metrora:getCompareModels': run((period: string, provider: string) => [
      'compare', '--format', 'json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)),
    ]),
    'metrora:getCompare': run((period: string, provider: string, modelA: string, modelB: string) => [
      'compare', '--format', 'json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)), '--model-a', vToken(modelA), '--model-b', vToken(modelB),
    ]),
    'metrora:getYield': run((period: string, provider: string, range?: DateRange) => [
      'yield', '--format', 'json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)), ...rangeArgs(vRange(range)),
    ]),
    'metrora:getSpendFlow': run((period: string, provider: string, range?: DateRange, projectScopeId?: string | null) => [
      'spend', '--format', 'flow-json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)), ...rangeArgs(vRange(range)),
      ...(validateProjectScope(projectScopeId) ? ['--metrora-project', validateProjectScope(projectScopeId)!] : []),
    ]),
    'metrora:getOptimizeReport': run((period: string, provider: string, range?: DateRange) => [
      'optimize', '--format', 'json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)), ...rangeArgs(vRange(range)),
    ]),
    'metrora:getDevices': run((period: string) => ['devices', '--format', 'json', '--period', vPeriod(period)]),
    'metrora:getDevicesScan': run(() => ['devices', 'scan', '--format', 'json']),
    'metrora:getShareStatus': deps.share
      ? async () => {
          try { return { ok: true, value: await deps.share!.status() } }
          catch (err) { return { ok: false, error: toEnvelopeError(err) } }
        }
      : run(() => ['share', 'status', '--format', 'json']),
    ...createShareBridgeHandlers(deps.share),
    'metrora:getIdentity': run(() => ['identity', '--format', 'json']),
    'metrora:getAliases': run(() => ['model-alias', '--list', '--format', 'json']),
    'metrora:getProxyPaths': run(() => ['proxy-path', '--list', '--format', 'json']),
    'metrora:getAudit': run((period: string, provider: string, range?: DateRange) => [
      'audit', '--format', 'json', '--period', vPeriod(period), ...providerArgs(vProvider(provider)), ...rangeArgs(vRange(range)),
    ]),
    'metrora:getPriceOverrides': run(() => ['price-override', '--list', '--format', 'json']),
    'metrora:setCurrency': runAction((code: string) => ['currency', vCurrency(code)]),
    'metrora:resetCurrency': runAction(() => ['currency', '--reset']),
    'metrora:addAlias': runAction((from: string, to: string) => ['model-alias', vToken(from), vToken(to)]),
    'metrora:removeAlias': runAction((from: string) => ['model-alias', '--remove', vToken(from)]),
    'metrora:setPriceOverride': runAction((model: string, rates: PriceRates) => priceOverrideArgs(model, rates)),
    'metrora:removePriceOverride': runAction((model: string) => ['price-override', '--remove', vToken(model)]),
    'metrora:removeDevice': runAction((name: string) => ['devices', 'rm', vToken(name)]),
    'metrora:setPlan': runAction((id: string, provider: string) => ['plan', 'set', vToken(id), '--provider', vProvider(provider)]),
    'metrora:resetPlan': runAction((provider: string) => ['plan', 'reset', '--provider', vProvider(provider)]),
    'metrora:exportData': runAction((format: string, provider: string, outPath: string) => [
      'export', '-f', vToken(format), '-o', vOutPath(outPath), '--provider', vProvider(provider),
    ]),
    'metrora:cliStatus': async () => {
      const p = deps.resolveMetroraPath()
      return { ok: true, value: { found: p !== null, path: p } }
    },
    // Telemetry consent + events. Value is null when telemetry is unavailable
    // (tests, or init failure) — the renderer treats null as "no onboarding".
    'metrora:telemetryStatus': async () => ({ ok: true, value: telemetry ? telemetry.status() : null }),
    'metrora:telemetrySetEnabled': async (enabled?: boolean) => ({ ok: true, value: telemetry ? telemetry.setEnabled(Boolean(enabled)) : null }),
    'metrora:telemetryOnboarded': async (enabled?: boolean) => ({ ok: true, value: telemetry ? telemetry.completeOnboarding(Boolean(enabled)) : null }),
    'metrora:telemetryTrack': async (name?: string, props?: unknown) => {
      telemetry?.track(String(name ?? ''), props)
      return { ok: true, value: true }
    },
    // One-shot read of the cached update-availability status. The check itself
    // runs in the background (launch + 24h); this returns whatever is known.
    'metrora:getUpdateStatus': async () => ({ ok: true, value: deps.getUpdateStatus ? await deps.getUpdateStatus() : NO_UPDATE_STATUS }),
  }
}

export function ipcChannelAliases(channel: string): string[] {
  return [channel]
}

export function shouldInstallApplicationMenu(isDev: boolean, platform = process.platform): boolean {
  return platform === 'darwin' || isDev
}

function registerHandlers(): void {
  const share = initializeDesktopShareRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  })
  const advisorCredentials = new AdvisorCredentialStore({
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => safeStorage.isEncryptionAvailable(),
      encryptStringAsync: plaintext => safeStorage.encryptStringAsync(plaintext),
      decryptStringAsync: ciphertext => safeStorage.decryptStringAsync(ciphertext),
      getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend(),
    },
  })
  const advisorHostedHandlers = createAdvisorHostedHandlers({
    credentialStatus: provider => advisorCredentials.status(provider),
    readCredential: provider => advisorCredentials.readSecret(provider),
    emitEvent: broadcastAdvisorHostedEvent,
  })
  const handlers = createBridgeHandlers({
    spawnCli,
    spawnCliAction,
    resolveMetroraPath,
    getQuota,
    emitProgress: broadcastProgress,
    telemetry: telemetryInstance,
    getUpdateStatus: () => updateChecker ? updateChecker.getStatus() : Promise.resolve(NO_UPDATE_STATUS),
    share,
    advisorCredentials,
    advisorHostedHandlers,
  })
  const advisorProtectedIpcChannels = new Set([
    'metrora:advisorHostedProbe',
  'metrora:advisorHostedChat',
  'metrora:advisorHostedCancel',
  'metrora:advisorCredentialStatus',
  'metrora:advisorCredentialSet',
  'metrora:advisorCredentialClear',
])
function isTrustedAdvisorSender(event: { senderFrame?: { url?: string } | null }): boolean {
  const frameUrl = event.senderFrame?.url
  if (!frameUrl) return false
  try {
    const parsed = new URL(frameUrl)
    if (parsed.protocol === 'file:') return true
    const devUrl = process.env.VITE_DEV_SERVER_URL
    return Boolean(devUrl && new URL(devUrl).origin === parsed.origin)
  } catch {
    return false
  }
}
  for (const [channel, handler] of Object.entries(handlers)) {
    for (const alias of ipcChannelAliases(channel)) {
      ipcMain.handle(alias, (event, ...args) => {
        if (advisorProtectedIpcChannels.has(channel) && !isTrustedAdvisorSender(event)) {
          return { ok: false, error: { kind: 'unauthorized', message: 'Advisor IPC request is not from the trusted renderer.' } }
        }
        return handler(...args)
      })
    }
  }
  const chooseDirectory = async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return { ok: true, value: res.canceled ? null : (res.filePaths[0] ?? null) }
  }
  ipcMain.handle('metrora:chooseDirectory', chooseDirectory)
  ipcMain.handle('open-external', (_event, url: string) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'https:' || protocol === 'http:') return shell.openExternal(url)
    } catch { /* malformed URL — refuse to open */ }
    return
  })
}

function installApplicationMenu(): void {
  const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL)
  Menu.setApplicationMenu(shouldInstallApplicationMenu(isDev)
    ? Menu.buildFromTemplate(createApplicationMenuTemplate(isDev))
    : null)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1013' : '#f5f6f8',
    // macOS: integrated title bar (traffic lights float over the sidebar), like
    // Linear/Hermes. Windows/Linux keep their native frame + window controls.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's default (kept explicit): when the window is minimized or fully
      // occluded the renderer's document.visibilityState flips to 'hidden' and a
      // visibilitychange fires. usePolled and the flame animation gate on that to
      // stop background CLI polls and compositor wakeups while hidden. A merely
      // unfocused-but-visible window stays 'visible' and keeps polling.
      backgroundThrottling: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // This window only ever renders the bundled renderer; block in-page navigation
  // and popups so a hijacked link can't turn it into a browser.
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl).catch(err => console.error('Failed to load dev server URL:', err))
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch(err => console.error('Failed to load renderer:', err))
  }

  return win
}

function bootstrap(): void {
  process.on('unhandledRejection', reason => {
    console.error('Unhandled promise rejection in main process:', reason)
  })

  // Packaged builds ship their own version-matched CLI under resources/cli (the
  // afterPack hook copies it in). Point the resolver at the launch shim before
  // any handler spawns; cli.ts runs it with Electron-as-node. The shim, not
  // cli.js, is the entry — it corrects argv for commander under Electron. Unset
  // in dev, where the repo build is used instead.
  if (app.isPackaged) {
    const bundledCli = path.join(process.resourcesPath, 'cli', 'dist', 'launch.js')
    process.env.METRORA_BUNDLED_CLI = bundledCli
    if (process.env.METRORA_BUNDLED_CLI === undefined) process.env.METRORA_BUNDLED_CLI = bundledCli
  }

  // A second launch focuses the running window instead of opening a rival one.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.on('before-quit', createBeforeQuitHandler({
    getTelemetry: () => telemetryInstance,
    killAll: shutdownCli,
    stopShare: stopDesktopShareRuntime,
    quit: () => app.quit(),
  }))

  void app.whenReady().then(() => {
    // Consent-gated anonymous telemetry (desktop only). Nothing transmits until
    // the onboarding consent screen is completed and the toggle is on; EU/EEA/
    // UK/CH installs default the toggle off. Dev builds never send.
    try {
      telemetryInstance = new Telemetry({
        stateDir: app.getPath('userData'),
        country: app.getLocaleCountryCode() || null,
        isPackaged: app.isPackaged,
        appVersion: app.getVersion(),
      })
      // completeOnboarding tracks the first app_open itself; only already-
      // onboarded installs record subsequent opens here.
      if (telemetryInstance.status().onboarded) telemetryInstance.track('app_open', {})
      setInterval(() => { void telemetryInstance?.flush() }, 5 * 60_000)
    } catch (err) {
      console.error('telemetry init failed (continuing without):', err)
    }
    registerHandlers()
    installApplicationMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // Update availability: check once at launch, then every 24h, pushing each
    // result to any open window. Never downloads/installs (unsigned builds);
    // errors are swallowed inside the checker as a silent no-op.
    updateChecker = createUpdateChecker({ currentVersion: app.getVersion() })
    const runUpdateCheck = () => { void updateChecker?.check().then(broadcastUpdateStatus) }
    runUpdateCheck()
    setInterval(runUpdateCheck, 24 * 60 * 60 * 1000)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

if (!process.env.VITEST) bootstrap()
