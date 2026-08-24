import { statSync } from 'node:fs'
import { lstat, open, opendir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter as pathDelimiter, join } from 'node:path'

import { isSqliteBusyError, openDatabase, type SqliteDatabase } from './sqlite.js'
import { COPILOT_DEFERRED_ENV_FINGERPRINTS, PROVIDER_ENV_FINGERPRINT_ADDITIONS } from './provider-parse-authorities.js'
import { PROVIDER_ENV_VARS } from './session-cache.js'
import type { ProbeRoot } from './providers/types.js'

export const DOCTOR_SOURCE_STATES = [
  'PRESENT',
  'PRESENT_EMPTY',
  'MISSING',
  'INACCESSIBLE',
  'MALFORMED',
  'UNSUPPORTED_VARIANT',
  'UNKNOWN',
] as const

export type DoctorSourceState = (typeof DOCTOR_SOURCE_STATES)[number]

export type DoctorSourceDiagnostic = {
  family: string
  state: DoctorSourceState
  root: string
  reason: string
  override?: string
}

export type DoctorPathProbe = {
  state: DoctorSourceState
  reason: string
  entries?: string[]
}

type StateReason = Pick<DoctorPathProbe, 'state' | 'reason'>

const MAX_DIRECTORY_ENTRIES = 128
const MAX_NESTED_ENTRIES = 32

function reasonForCode(code: string | undefined): StateReason | undefined {
  if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'MISSING', reason: 'source is absent' }
  if (code === 'EACCES' || code === 'EPERM') return { state: 'INACCESSIBLE', reason: 'permission denied' }
  return undefined
}

export function classifyDoctorError(error: unknown): StateReason {
  if (isSqliteBusyError(error)) return { state: 'UNKNOWN', reason: 'SQLite is busy or locked' }
  const value = error as { code?: unknown; message?: unknown; name?: unknown } | null
  const code = typeof value?.code === 'string' ? value.code : undefined
  const byCode = reasonForCode(code)
  if (byCode) return byCode
  const message = typeof value?.message === 'string' ? value.message : ''
  if (value?.name === 'SyntaxError' || /not a database|malformed|corrupt|invalid json|unexpected end/i.test(message)) {
    return { state: 'MALFORMED', reason: 'recognized source is corrupted' }
  }
  return { state: 'UNKNOWN', reason: 'source could not be classified safely' }
}

function rootReplacements(): Array<[string, string]> {
  const roots: Array<[string, string]> = []
  const home = homedir()
  const envRoots: Array<[string, string]> = [
    ['APPDATA', '%APPDATA%'],
    ['LOCALAPPDATA', '%LOCALAPPDATA%'],
    ['XDG_CONFIG_HOME', '%XDG_CONFIG_HOME%'],
    ['XDG_DATA_HOME', '%XDG_DATA_HOME%'],
    ['HOME', '~'],
    ['USERPROFILE', '~'],
  ]
  for (const [name, replacement] of envRoots) {
    const value = process.env[name]
    if (value) roots.push([value, replacement])
  }
  roots.push([join(home, 'AppData', 'Roaming'), '%APPDATA%'])
  roots.push([join(home, 'AppData', 'Local'), '%LOCALAPPDATA%'])
  roots.push([home, '~'])
  return roots.sort((a, b) => b[0].length - a[0].length)
}

export function redactPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  for (const [rawRoot, replacement] of rootReplacements()) {
    const root = rawRoot.replace(/\\/g, '/').replace(/\/$/, '')
    const rootLower = root.toLowerCase()
    if (lower === rootLower) return replacement
    if (lower.startsWith(rootLower + '/')) return replacement + normalized.slice(root.length)
  }
  if (/^(?:[a-z]:\/|\/|\\\\)/i.test(normalized)) return '<redacted-path>'
  return normalized
}

// An explicit provider override is user-controlled input, even when it happens
// to sit below a familiar root such as %APPDATA% or ~. Do not preserve any
// suffix: it may contain a profile, workspace, project, or session-derived
// component. The family row still carries the static family name and the
// override variable name, so the diagnostic remains actionable without
// disclosing the configured value.
export function redactOverridePath(_value: string): string {
  return '<override-path>'
}

const NON_PATH_OVERRIDE_NAMES = new Set([
  'AI_GATEWAY_API_KEY',
  'KIMI_MODEL_NAME',
  'METRORA_COPILOT_DISABLE_OTEL',
  'VERCEL_OIDC_TOKEN',
])

function looksLikePathOverride(name: string): boolean {
  return !NON_PATH_OVERRIDE_NAMES.has(name) && /(?:HOME|DIR|PATH|ROOT|DB|CONFIG|PREFIX)/i.test(name)
}

function overridePathCandidates(name: string, value: string): string[] {
  const values = name.endsWith('DIRS') ? value.split(pathDelimiter) : [value]
  return values.flatMap(item => {
    const trimmed = item.trim()
    if (!trimmed) return []
    if (trimmed === '~') return [homedir()]
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return [join(homedir(), trimmed.slice(2))]
    return [trimmed]
  })
}

function isPathWithinRoot(value: string, root: string): boolean {
  const normalizedValue = value.replace(/\\/g, '/').replace(/\/$/, '')
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
  const valueLower = normalizedValue.toLowerCase()
  const rootLower = normalizedRoot.toLowerCase()
  return valueLower === rootLower || valueLower.startsWith(rootLower + '/')
}

function overrideNameForPath(value: string): string | undefined {
  const names = new Set<string>([
    ...Object.values(PROVIDER_ENV_VARS).flat(),
    ...Object.values(PROVIDER_ENV_FINGERPRINT_ADDITIONS).flat(),
    ...COPILOT_DEFERRED_ENV_FINGERPRINTS,
    'METRORA_DESKTOP_SESSIONS_DIR',
  ])
  const active = [...names]
    .filter(name => looksLikePathOverride(name))
    .flatMap(name => {
      const raw = process.env[name]
      return raw ? overridePathCandidates(name, raw).map(root => ({ name, root })) : []
    })
    .sort((a, b) => b.root.length - a.root.length)
  return active.find(candidate => isPathWithinRoot(value, candidate.root))?.name
}

export function redactDoctorPath(value: string): string {
  return overrideNameForPath(value) ? redactOverridePath(value) : redactPath(value)
}

export function redactText(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^"'\n]+/g, '<redacted-path>')
    .replace(/\\\\[^"'\n]+/g, '<redacted-path>')
    .replace(/(^|[\s("'])\/[^"'\n]*/g, '$1<redacted-path>')
}

async function readBoundedDirectoryEntries(path: string): Promise<string[]> {
  const directory = await opendir(path)
  const entries: string[] = []
  try {
    while (entries.length < MAX_DIRECTORY_ENTRIES) {
      const entry = await directory.read()
      if (!entry) break
      entries.push(entry.name)
    }
    return entries
  } finally {
    await directory.close().catch(() => {})
  }
}

export async function inspectPath(path: string): Promise<DoctorPathProbe> {
  try {
    const info = await lstat(path)
    if (info.isDirectory()) {
      const entries = await readBoundedDirectoryEntries(path)
      return entries.length === 0
        ? { state: 'PRESENT_EMPTY', reason: 'directory is readable but has no entries', entries }
        : { state: 'PRESENT', reason: 'directory is readable', entries: entries.slice(0, MAX_DIRECTORY_ENTRIES) }
    }
    if (info.isFile()) {
      const handle = await open(path, 'r')
      await handle.close()
      return { state: 'PRESENT', reason: 'source is readable' }
    }
    return { state: 'UNSUPPORTED_VARIANT', reason: 'source is neither a regular file nor directory' }
  } catch (error) {
    return classifyDoctorError(error)
  }
}

async function readDirectory(path: string): Promise<DoctorPathProbe> {
  try {
    const info = await lstat(path)
    if (!info.isDirectory()) return { state: 'UNSUPPORTED_VARIANT', reason: 'expected a directory' }
    const entries = await readBoundedDirectoryEntries(path)
    return entries.length === 0
      ? { state: 'PRESENT_EMPTY', reason: 'directory is readable but has no supported sources', entries }
      : { state: 'PRESENT', reason: 'directory is readable', entries: entries.slice(0, MAX_DIRECTORY_ENTRIES) }
  } catch (error) {
    return classifyDoctorError(error)
  }
}

async function inspectJsonLines(path: string): Promise<StateReason> {
  try {
    const raw = await readFile(path, 'utf8')
    const line = raw.split(/\r?\n/).find(item => item.trim())
    if (!line) return { state: 'PRESENT_EMPTY', reason: 'source is readable but empty' }
    const parsed: unknown = JSON.parse(line)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { state: 'PRESENT', reason: 'recognized JSON source is readable' }
      : { state: 'UNSUPPORTED_VARIANT', reason: 'JSON source shape is not supported' }
  } catch (error) {
    return classifyDoctorError(error)
  }
}

async function inspectJsonDocument(path: string, requiredArray?: string): Promise<StateReason> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: 'UNSUPPORTED_VARIANT', reason: 'JSON document shape is not supported' }
    }
    if (requiredArray && !Array.isArray((parsed as Record<string, unknown>)[requiredArray])) {
      return { state: 'UNSUPPORTED_VARIANT', reason: 'recognized JSON document has an unsupported version' }
    }
    return { state: 'PRESENT', reason: 'recognized JSON source is readable' }
  } catch (error) {
    return classifyDoctorError(error)
  }
}

export function inspectReadonlySqlite(
  path: string,
  requiredTables: readonly string[],
  classifyRows?: (db: SqliteDatabase) => StateReason,
): DoctorPathProbe {
  try {
    statSync(path)
  } catch (error) {
    return classifyDoctorError(error)
  }
  try {
    const db = openDatabase(path)
    try {
      const tables = new Set(db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).map(row => row.name))
      const missing = requiredTables.find(table => !tables.has(table))
      if (missing) return { state: 'UNSUPPORTED_VARIANT', reason: 'SQLite schema is not supported' }
      return classifyRows?.(db) ?? { state: 'PRESENT', reason: 'recognized SQLite source is readable' }
    } finally {
      db.close()
    }
  } catch (error) {
    return classifyDoctorError(error)
  }
}

function diagnostic(family: string, root: string, probe: StateReason, override?: string): DoctorSourceDiagnostic {
  const effectiveOverride = override ?? overrideNameForPath(root)
  return {
    family,
    root: effectiveOverride ? redactOverridePath(root) : redactPath(root),
    state: probe.state,
    reason: probe.reason,
    ...(effectiveOverride ? { override: effectiveOverride } : {}),
  }
}

function overrideNameFor(providerName: string, family: string): string | undefined {
  if (providerName === 'kiro' && (family === 'cli' || family === 'kiro-v2') && process.env['KIRO_HOME']) return 'KIRO_HOME'
  if (providerName !== 'copilot') return undefined
  if (family === 'otel-agent-traces') {
    if (process.env['METRORA_COPILOT_OTEL_DB']) return 'METRORA_COPILOT_OTEL_DB'
    if (process.env['METRORA_COPILOT_DISABLE_OTEL'] === '1') return 'METRORA_COPILOT_DISABLE_OTEL'
  }
  if (family === 'cli-session-state' && process.env['METRORA_COPILOT_SESSION_STATE_DIR']) return 'METRORA_COPILOT_SESSION_STATE_DIR'
  if (family === 'vscode-workspace-storage' && process.env['METRORA_COPILOT_WS_STORAGE_DIR']) return 'METRORA_COPILOT_WS_STORAGE_DIR'
  if (family === 'empty-window-global-storage' && process.env['METRORA_COPILOT_GLOBAL_STORAGE_DIR']) return 'METRORA_COPILOT_GLOBAL_STORAGE_DIR'
  if (family === 'jetbrains' && process.env['METRORA_COPILOT_JETBRAINS_DIR']) return 'METRORA_COPILOT_JETBRAINS_DIR'
  return undefined
}

function cursorSqlite(path: string): DoctorSourceDiagnostic {
  const probe = inspectReadonlySqlite(path, ['cursorDiskKV'], db => {
    const rows = db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' OR key LIKE 'agentKv:%'",
    )
    return Number(rows[0]?.count ?? 0) > 0
      ? { state: 'PRESENT', reason: 'recognized Cursor state with supported records' }
      : { state: 'PRESENT_EMPTY', reason: 'recognized Cursor state has no supported records' }
  })
  return diagnostic('global-state', path, probe)
}

async function cursorWorkspace(path: string): Promise<DoctorSourceDiagnostic> {
  const directory = await readDirectory(path)
  if (!directory.entries || directory.state !== 'PRESENT') return diagnostic('workspace-storage', path, directory)
  let recognized = false
  for (const entry of directory.entries.slice(0, MAX_NESTED_ENTRIES)) {
    const entryPath = join(path, entry)
    const info = await inspectPath(entryPath)
    if (info.state !== 'PRESENT') continue
    const workspaceJson = join(entryPath, 'workspace.json')
    const workspace = await inspectPath(workspaceJson)
    if (workspace.state === 'PRESENT') {
      const parsed = await inspectJsonDocument(workspaceJson)
      if (parsed.state === 'MALFORMED') return diagnostic('workspace-storage', path, parsed)
      if (parsed.state === 'PRESENT') recognized = true
    }
    const workspaceDb = join(entryPath, 'state.vscdb')
    const db = await inspectPath(workspaceDb)
    if (db.state === 'PRESENT') {
      const schema = inspectReadonlySqlite(workspaceDb, ['ItemTable'])
      if (schema.state === 'MALFORMED' || schema.state === 'UNKNOWN') return diagnostic('workspace-storage', path, schema)
      if (schema.state === 'PRESENT') recognized = true
    }
  }
  return diagnostic('workspace-storage', path, recognized
    ? { state: 'PRESENT', reason: 'recognized Cursor workspace storage is readable' }
    : { state: 'PRESENT_EMPTY', reason: 'workspace storage has no supported sessions' })
}

function kiroDirectory(path: string, family: string): Promise<DoctorSourceDiagnostic> {
  const override = overrideNameFor('kiro', family)
  return readDirectory(path).then(async directory => {
    if (!directory.entries || directory.state !== 'PRESENT') return diagnostic(family, path, directory, override)
    if (family === 'cli') {
      const files = directory.entries.filter(entry => entry.endsWith('.jsonl'))
      if (files.length === 0) return diagnostic(family, path, { state: 'PRESENT_EMPTY', reason: 'directory has no supported sessions' }, override)
      for (const file of files.slice(0, MAX_NESTED_ENTRIES)) {
        const probe = await inspectJsonLines(join(path, file))
        if (probe.state === 'MALFORMED' || probe.state === 'UNKNOWN') return diagnostic(family, path, probe, override)
      }
      return diagnostic(family, path, { state: 'PRESENT', reason: 'recognized Kiro CLI sessions are readable' }, override)
    }
    if (family === 'kiro-v2') {
      let supported = false
      for (const hash of directory.entries.slice(0, MAX_NESTED_ENTRIES)) {
        const hashPath = join(path, hash)
        const hashProbe = await inspectPath(hashPath)
        if (hashProbe.state !== 'PRESENT' || !hashProbe.entries) continue
        for (const session of hashProbe.entries.filter(entry => entry.startsWith('sess_')).slice(0, MAX_NESTED_ENTRIES)) {
          const sessionPath = join(hashPath, session)
          const messagePath = join(sessionPath, 'messages.jsonl')
          const messageProbe = await inspectPath(messagePath)
          if (messageProbe.state !== 'PRESENT') continue
          const meta = await inspectJsonDocument(join(sessionPath, 'session.json'), 'workspacePaths')
          if (meta.state === 'MALFORMED' || meta.state === 'UNKNOWN') return diagnostic(family, path, meta, override)
          if (meta.state === 'PRESENT' || meta.state === 'MISSING') supported = true
        }
      }
      return diagnostic(family, path, supported
        ? { state: 'PRESENT', reason: 'recognized Kiro v2 sessions are readable' }
        : { state: 'PRESENT_EMPTY', reason: 'Kiro v2 root has no supported sessions' }, override)
    }
    const supported = family === 'legacy-ide' || family === 'legacy-ide-server'
      ? directory.entries.some(entry => entry === 'workspace-sessions' || /^[a-f0-9]{32}$/i.test(entry))
      : directory.entries.some(entry => entry.length > 0)
    return diagnostic(family, path, supported
      ? { state: 'PRESENT', reason: 'recognized Kiro IDE storage is readable' }
      : { state: 'PRESENT_EMPTY', reason: 'Kiro storage has no supported sessions' }, override)
  })
}

async function copilotJsonDirectory(path: string, family: string, nested: boolean): Promise<DoctorSourceDiagnostic> {
  const override = overrideNameFor('copilot', family)
  const directory = await readDirectory(path)
  if (!directory.entries || directory.state !== 'PRESENT') return diagnostic(family, path, directory, override)
  const files: string[] = []
  for (const entry of directory.entries.slice(0, MAX_NESTED_ENTRIES)) {
    const entryPath = join(path, entry)
    const info = await inspectPath(entryPath)
    if (info.state !== 'PRESENT') continue
    if (!nested && entry.endsWith('.jsonl')) files.push(entryPath)
    if (nested && info.entries) {
      for (const hash of info.entries.slice(0, MAX_NESTED_ENTRIES)) {
        const hashPath = join(entryPath, hash)
        const hashInfo = await inspectPath(hashPath)
        if (hashInfo.state !== 'PRESENT') continue
        const candidates = [join(hashPath, 'chatSessions'), join(hashPath, 'GitHub.copilot-chat', 'transcripts')]
        for (const candidate of candidates) {
          const candidateInfo = await inspectPath(candidate)
          if (candidateInfo.state !== 'PRESENT' || !candidateInfo.entries) continue
          for (const file of candidateInfo.entries.filter(item => item.endsWith('.jsonl')).slice(0, MAX_NESTED_ENTRIES)) files.push(join(candidate, file))
        }
      }
    }
  }
  if (files.length === 0) return diagnostic(family, path, { state: 'PRESENT_EMPTY', reason: 'directory has no supported sessions' }, override)
  for (const file of files.slice(0, MAX_NESTED_ENTRIES)) {
    const probe = await inspectJsonLines(file)
    if (probe.state === 'MALFORMED' || probe.state === 'UNKNOWN') return diagnostic(family, path, probe, override)
  }
  return diagnostic(family, path, { state: 'PRESENT', reason: 'recognized Copilot JSON sources are readable' }, override)
}

async function copilotJetBrains(path: string): Promise<DoctorSourceDiagnostic> {
  const override = overrideNameFor('copilot', 'jetbrains')
  const root = await readDirectory(path)
  if (!root.entries || root.state !== 'PRESENT') return diagnostic('jetbrains', path, root, override)
  let found = false
  for (const ide of root.entries.slice(0, MAX_NESTED_ENTRIES)) {
    const ideInfo = await inspectPath(join(path, ide))
    if (ideInfo.state !== 'PRESENT' || !ideInfo.entries) continue
    for (const kind of ideInfo.entries.slice(0, MAX_NESTED_ENTRIES)) {
      const kindInfo = await inspectPath(join(path, ide, kind))
      if (kindInfo.state !== 'PRESENT' || !kindInfo.entries) continue
      for (const store of kindInfo.entries.slice(0, MAX_NESTED_ENTRIES)) {
        const storeInfo = await inspectPath(join(path, ide, kind, store))
        if (storeInfo.state !== 'PRESENT' || !storeInfo.entries) continue
        const db = storeInfo.entries.find(entry => entry.endsWith('-nitrite.db') || entry.endsWith('.db'))
        if (!db) continue
        const dbInfo = await inspectPath(join(path, ide, kind, store, db))
        if (dbInfo.state !== 'PRESENT') continue
        found = true
      }
    }
  }
  return diagnostic('jetbrains', path, found
    ? { state: 'PRESENT', reason: 'recognized JetBrains Copilot stores are readable' }
    : { state: 'PRESENT_EMPTY', reason: 'JetBrains root has no supported stores' }, override)
}

export async function diagnoseProviderSources(
  providerName: string,
  roots: readonly ProbeRoot[],
): Promise<DoctorSourceDiagnostic[]> {
  const out: DoctorSourceDiagnostic[] = []
  for (const root of roots) {
    if (providerName === 'cursor' && root.label === 'global-state') out.push(cursorSqlite(root.path))
    else if (providerName === 'cursor' && root.label === 'workspace-storage') out.push(await cursorWorkspace(root.path))
    else if (providerName === 'kiro') out.push(await kiroDirectory(root.path, root.label))
    else if (providerName === 'copilot' && root.label === 'otel-agent-traces') {
      const override = overrideNameFor('copilot', root.label)
      const probe = inspectReadonlySqlite(root.path, ['spans', 'span_attributes'], db => {
        const rows = db.query<{ count: number }>('SELECT COUNT(*) AS count FROM spans')
        return Number(rows[0]?.count ?? 0) > 0
          ? { state: 'PRESENT', reason: 'recognized Copilot OTel store has spans' }
          : { state: 'PRESENT_EMPTY', reason: 'recognized Copilot OTel store has no spans' }
      })
      out.push(diagnostic(root.label, root.path, probe, override))
    } else if (providerName === 'copilot' && root.label === 'cli-session-state') {
      out.push(await copilotJsonDirectory(root.path, root.label, false))
    } else if (providerName === 'copilot' && root.label === 'vscode-workspace-storage') {
      out.push(await copilotJsonDirectory(root.path, root.label, true))
    } else if (providerName === 'copilot' && root.label === 'empty-window-global-storage') {
      out.push(await copilotJsonDirectory(root.path, root.label, false))
    } else if (providerName === 'copilot' && root.label === 'jetbrains') {
      out.push(await copilotJetBrains(root.path))
    } else {
      out.push(diagnostic(root.label, root.path, await inspectPath(root.path)))
    }
  }
  return out
}

export function doctorProbePath(diagnosticRow: DoctorSourceDiagnostic): { path: string; label: string; exists: boolean; state: DoctorSourceState; reason: string } {
  return {
    path: diagnosticRow.root,
    label: diagnosticRow.family,
    exists: diagnosticRow.state === 'PRESENT' || diagnosticRow.state === 'PRESENT_EMPTY',
    state: diagnosticRow.state,
    reason: diagnosticRow.reason,
  }
}
