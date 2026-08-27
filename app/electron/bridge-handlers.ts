import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { CliError, type ActionResult, type SpawnPriority } from './cli'
import type { TrustedProgressEvent } from './cli-watchdog'
import { getQuota, sanitizeError } from './quota'
import { sanitizeQuotaProviders } from './quota/types'
import { createShareBridgeHandlers } from './share-bridge'
import type { DesktopShareRuntime } from './share-runtime'
import { Telemetry } from './telemetry'
import type { UpdateStatus } from './updates'
import { createProjectBridgeHandlers, validateProjectScope } from './project-bridge'
import { createAdvisorRuntimeHandlers } from './advisor-runtime'
import { AdvisorCredentialStore, type AdvisorCredentialProvider } from './advisor-credentials'

export type Envelope<T = unknown> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } }
export type TelemetryBridge = Pick<Telemetry, 'status' | 'setEnabled' | 'completeOnboarding' | 'track'>
export type DateRange = { from: string; to: string }
type Handler = (...args: any[]) => Promise<Envelope>

type Deps = {
  spawnCli: (args: string[], opts?: { timeoutMs?: number; idleTimeoutMs?: number; onStderr?: (chunk: string) => void; onProgress?: (event: TrustedProgressEvent) => void; extraEnv?: NodeJS.ProcessEnv; priority?: SpawnPriority }) => Promise<unknown>
  spawnCliAction: (args: string[], opts?: { timeoutMs?: number }) => Promise<ActionResult>
  resolveMetroraPath: () => string | null
  getQuota?: typeof getQuota
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

export const NO_UPDATE_STATUS: UpdateStatus = { currentVersion: '', latestVersion: null, updateAvailable: false, tag: null }
const WARMUP_TIMEOUT_MS = 10 * 60_000
const PROGRESS_IDLE_TIMEOUT_MS = 45_000
const PROGRESS_LINE_PREFIX = 'METRORA_PROGRESS '

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

function providerArgs(provider: string | undefined): string[] {
  return provider && provider !== 'all' ? ['--provider', provider] : []
}

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

/**
 * Maps every MetroraBridge channel to its `metrora` argv (plain args, no
 * shell) and returns a result envelope. Pure + injectable so the wiring is
 * unit-testable without launching Electron.
 */
export function createBridgeHandlers(deps: Deps): Record<string, Handler> {
  const snapshotEnv = { METRORA_READ_MODE: 'snapshot' }
  const readQuota = deps.getQuota ?? getQuota
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
      try { return { ok: true, value: sanitizeQuotaProviders(await readQuota({ force: Boolean(force) })) } }
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
    'metrora:getBenchModelDiscovery': run(() => ['bench', 'models', '--format', 'json']),
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
