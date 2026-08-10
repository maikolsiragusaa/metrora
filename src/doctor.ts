import { existsSync } from 'fs'
import { dirname } from 'path'

import { allProviderNames, getAllProviders, safeDiscoverSessions } from './providers/index.js'
import { emptyCache, loadCache, PROVIDER_ENV_VARS, type SessionCache } from './session-cache.js'
import type { Provider } from './providers/types.js'

export type DoctorEnvOverride = {
  name: string
  value: string
}

export type DoctorProbePath = {
  path: string
  label: string
  exists: boolean
}

export type DoctorProviderReport = {
  provider: string
  displayName: string
  status: 'ok' | 'empty' | 'error'
  discoveredSources: number
  sampledCalls: number
  probePaths: DoctorProbePath[]
  envOverrides: DoctorEnvOverride[]
  verdict: string
  error?: string
}

export type DoctorReport = {
  generatedAt: string
  providers: DoctorProviderReport[]
}

export type CollectDoctorOptions = {
  /** Injectable provider list (defaults to the real registry). */
  providers?: Provider[]
  /** Injectable cache snapshot (defaults to reading session-cache.json). */
  cache?: SessionCache
  /** Max discovered sources to parse-sample per provider. */
  sampleLimit?: number
}

// Bound the parse sample: at most this many discovered sources per provider,
// truncating each source's yields at PARSE_CALL_CAP. Note the cap bounds the
// yield loop only; eager parsers (codex, cursor) do their full per-file work
// before the first yield, so a very large single source is still parsed whole.
const DEFAULT_SAMPLE_LIMIT = 8
const PARSE_CALL_CAP = 500

// Providers whose parse() has side effects beyond reading: antigravity probes
// for a live language server (spawns ps/lsof and RPCs it when found). A
// diagnostic that promises to be inert must not sample-parse those; discovery
// (readdir/stat only) still runs, so session counts stay meaningful.
const PARSE_SPAWNS = new Set(['antigravity'])

// Declared env inputs that change parsing/accounting but not where discovery
// looks. They belong in the cache fingerprint, but must never be blamed for a
// NOTHING FOUND result.
const NON_DISCOVERY_ENV_VARS = new Set([
  'METRORA_CACHE_DIR',
  'METRORA_CURSOR_MAX_BUBBLES',
  'KIMI_MODEL_NAME',
])

// Windows supplies these to ordinary processes, so they move discovery roots
// and must be fingerprinted but do not represent deliberate user overrides.
const AMBIENT_ENV_VARS = new Set(['APPDATA', 'LOCALAPPDATA'])

// Credential presence is useful diagnostic state; the value is a live secret
// and must never reach text or JSON doctor output.
const SECRET_ENV_VARS = new Set(['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'])

// ── Collect (pure, testable) ─────────────────────────────────────────────

function collectEnvOverrides(providerName: string): DoctorEnvOverride[] {
  const vars = PROVIDER_ENV_VARS[providerName] ?? []
  const out: DoctorEnvOverride[] = []
  for (const name of vars) {
    if (AMBIENT_ENV_VARS.has(name)) continue
    const value = process.env[name]
    if (value !== undefined && value !== '') {
      out.push(SECRET_ENV_VARS.has(name) ? { name, value: '<set>' } : { name, value })
    }
  }
  return out
}

async function collectProbePaths(provider: Provider): Promise<DoctorProbePath[]> {
  if (!provider.probeRoots) return []
  const roots = await provider.probeRoots()
  return roots.map(r => ({ path: r.path, label: r.label, exists: existsSync(r.path) }))
}

// A discovered source path can carry a virtual suffix (`<db>#cursor-ws=...`,
// `<db>:<sessionId>`); strip it to the real on-disk path, then to its parent
// dir so many per-session sources collapse to a handful of probed directories.
function realPathOf(sourcePath: string): string {
  const hashIdx = sourcePath.indexOf('#')
  let p = hashIdx > 0 ? sourcePath.slice(0, hashIdx) : sourcePath
  const colonIdx = p.lastIndexOf(':')
  // Keep Windows drive letters (`C:\...`): only strip a colon that is not the
  // drive separator (index > 1).
  if (colonIdx > 1) p = p.slice(0, colonIdx)
  return p
}

function derivePathsFromSources(sourcePaths: string[]): DoctorProbePath[] {
  const dirs = new Set<string>()
  for (const sp of sourcePaths) {
    const real = realPathOf(sp)
    dirs.add(existsSync(real) ? dirname(real) : real)
  }
  return [...dirs].sort().map(path => ({ path, label: 'discovered', exists: existsSync(path) }))
}

function pluralSessions(n: number): string {
  return `${n} session${n === 1 ? '' : 's'}`
}

function emptyVerdict(
  probePaths: DoctorProbePath[],
  envOverrides: DoctorEnvOverride[],
): string {
  const discoveryOverrides = envOverrides.filter(o => !NON_DISCOVERY_ENV_VARS.has(o.name))
  const overrideNames = discoveryOverrides.map(o => o.name).join(', ')
  const hasOverride = discoveryOverrides.length > 0
  const known = probePaths.filter(p => p.label !== 'discovered')
  const missing = known.filter(p => !p.exists)
  const present = known.filter(p => p.exists)

  // No known probe roots to check: honest, override-aware fallback.
  if (known.length === 0) {
    return hasOverride
      ? `NOTHING FOUND (override ${overrideNames} set, but nothing was discovered)`
      : 'NOTHING FOUND (tool likely not installed or no history yet)'
  }
  // With an override set, a missing probed path is the likely culprit; name it
  // so the row itself points at the misconfiguration (Details lists them all).
  if (hasOverride) {
    if (missing.length > 0) return `NOTHING FOUND (override ${overrideNames} set; ${missing[0]!.path} does not exist)`
    return `NOTHING FOUND (override ${overrideNames} set; probed path exists but holds no sessions)`
  }
  if (present.length > 0) return `NOTHING FOUND (${present[0]!.path} exists but holds no sessions; no history yet)`
  return `NOTHING FOUND (${missing[0]?.path ?? 'probed path'} does not exist; tool likely not installed)`
}

function okVerdict(discoveredSources: number, sampledCalls: number): string {
  if (sampledCalls > 0) return `OK (${pluralSessions(discoveredSources)}, sampled ${sampledCalls.toLocaleString('en-US')} calls)`
  return `OK (${pluralSessions(discoveredSources)} discovered)`
}

async function sampleProvider(provider: Provider, sources: Awaited<ReturnType<typeof safeDiscoverSessions>>, limit: number): Promise<number> {
  if (PARSE_SPAWNS.has(provider.name)) return 0
  let calls = 0
  const seen = new Set<string>()
  for (const source of sources.slice(0, limit)) {
    const parser = provider.createSessionParser(source, seen)
    for await (const _call of parser.parse()) {
      calls++
      if (calls >= PARSE_CALL_CAP) return calls
    }
  }
  return calls
}

export async function collectDoctorReport(
  providerName = 'all',
  opts: CollectDoctorOptions = {},
): Promise<DoctorReport> {
  const providers = opts.providers ?? await getAllProviders()
  const cache = opts.cache ?? (await loadCache().catch(() => null) ?? emptyCache())
  const sampleLimit = Math.max(0, opts.sampleLimit ?? DEFAULT_SAMPLE_LIMIT)
  const selected = providerName === 'all'
    ? providers
    : providers.filter(p => p.name === providerName)

  if (providerName !== 'all' && !allProviderNames().includes(providerName) && selected.length === 0) {
    return { generatedAt: new Date().toISOString(), providers: [] }
  }

  const rows: DoctorProviderReport[] = []
  for (const provider of selected) {
    try {
      const sources = await safeDiscoverSessions(provider)
      let probePaths = await collectProbePaths(provider)
      if (probePaths.length === 0 && sources.length > 0) probePaths = derivePathsFromSources(sources.map(s => s.path))
      const envOverrides = collectEnvOverrides(provider.name)
      const sampledCalls = sampleLimit > 0 && sources.length > 0
        ? await sampleProvider(provider, sources, sampleLimit)
        : 0
      const status: DoctorProviderReport['status'] = sources.length > 0 ? 'ok' : 'empty'
      rows.push({
        provider: provider.name,
        displayName: provider.displayName,
        status,
        discoveredSources: sources.length,
        sampledCalls,
        probePaths,
        envOverrides,
        verdict: status === 'ok'
          ? okVerdict(sources.length, sampledCalls)
          : emptyVerdict(probePaths, envOverrides),
      })
    } catch (err) {
      rows.push({
        provider: provider.name,
        displayName: provider.displayName,
        status: 'error',
        discoveredSources: 0,
        sampledCalls: 0,
        probePaths: [],
        envOverrides: collectEnvOverrides(provider.name),
        verdict: 'ERROR',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Cache-only providers are useful evidence too: an installed source may have
  // disappeared while durable history remains. Add them only for an all-provider
  // diagnostic and never duplicate a real provider row.
  if (providerName === 'all') {
    const seen = new Set(rows.map(row => row.provider))
    for (const [name, section] of Object.entries(cache.providers)) {
      if (seen.has(name)) continue
      rows.push({
        provider: name,
        displayName: name,
        status: Object.keys(section.files).length > 0 ? 'ok' : 'empty',
        discoveredSources: 0,
        sampledCalls: 0,
        probePaths: [],
        envOverrides: collectEnvOverrides(name),
        verdict: Object.keys(section.files).length > 0
          ? `CACHE ONLY (${Object.keys(section.files).length.toLocaleString('en-US')} retained sources)`
          : 'CACHE ONLY (empty)',
      })
    }
  }

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return { generatedAt: new Date().toISOString(), providers: rows }
}

function renderPathSummary(paths: DoctorProbePath[]): string {
  if (paths.length === 0) return '-'
  return paths.map(p => `${p.exists ? '✓' : '✗'} ${p.path}`).join(', ')
}

function renderOverrideSummary(overrides: DoctorEnvOverride[]): string {
  if (overrides.length === 0) return '-'
  return overrides.map(o => `${o.name}=${o.value}`).join(', ')
}

export function renderDoctorTable(report: DoctorReport): string {
  const rows = report.providers.map(r => [
    r.displayName,
    r.status.toUpperCase(),
    r.discoveredSources.toLocaleString('en-US'),
    r.sampledCalls.toLocaleString('en-US'),
    r.verdict,
    renderPathSummary(r.probePaths),
    renderOverrideSummary(r.envOverrides),
  ])
  const headers = ['Provider', 'Status', 'Sources', 'Calls', 'Verdict', 'Paths', 'Overrides']
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]?.length ?? 0)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ')
  return [line(headers), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

export function renderDoctorJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2)
}
