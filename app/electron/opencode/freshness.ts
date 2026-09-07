import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { OPENCODE_ACCOUNTING_EXTRA_DATA_DIRS_ENV, OPENCODE_ACCOUNTING_ENV_MAX_BYTES } from './accounting'

const MAX_EXTRA_DATA_DIRS = 8
const MAX_EXTRA_DATA_DIR_LENGTH = 4096
const DB_PREFIX = 'opencode'
const STATE_VERSION = 1

type FileSignature = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
}

type DatabaseSignature = {
  name: string
  main: FileSignature
  wal: FileSignature | null
  journal: FileSignature | null
}

type RootSignature = {
  root: string
  exists: boolean
  databases: DatabaseSignature[]
}

type PersistedFreshnessState = {
  version: typeof STATE_VERSION
  signature: string
  lastSuccessAt: number
}

export type OpenCodeSourceFingerprint = {
  signature: string
  rootCount: number
  existingRootCount: number
  databaseCount: number
  elapsedMs: number
}

export type OpenCodeFreshnessSnapshot = OpenCodeSourceFingerprint & {
  changed: boolean
}

export type OpenCodeSourceChangeDetector = {
  check: () => Promise<OpenCodeFreshnessSnapshot>
  commit: (snapshot: OpenCodeFreshnessSnapshot) => Promise<boolean>
}

export type OpenCodeSourceChangeDetectorOptions = {
  statePath: string
  environment?: NodeJS.ProcessEnv
  now?: () => number
}

function trace(stage: string, fields: Record<string, string | number | boolean>): void {
  if (process.env['METRORA_RECONCILIATION_DEBUG'] !== '1') return
  try {
    process.stderr.write(`METRORA_RECONCILIATION ${JSON.stringify({ stage, ...fields })}\n`)
  } catch {
    // Diagnostics must never affect polling or reconciliation.
  }
}

function normalizedKey(value: string): string {
  const normalized = path.normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function parseExtraRoots(environment: NodeJS.ProcessEnv): string[] {
  const raw = environment[OPENCODE_ACCOUNTING_EXTRA_DATA_DIRS_ENV]
  if (!raw || Buffer.byteLength(raw, 'utf8') > OPENCODE_ACCOUNTING_ENV_MAX_BYTES) return []

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed) || parsed.length > MAX_EXTRA_DATA_DIRS) return []

  const roots = new Map<string, string>()
  for (const value of parsed) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_EXTRA_DATA_DIR_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(value) ||
      !path.isAbsolute(value)
    ) continue
    const root = path.normalize(value)
    roots.set(normalizedKey(root), root)
  }
  return [...roots.values()].sort((left, right) => left.localeCompare(right))
}

function resolveRoots(environment: NodeJS.ProcessEnv): string[] {
  const primary = environment['OPENCODE_DATA_DIR']
    || path.join(environment['XDG_DATA_HOME'] || path.join(homedir(), '.local', 'share'), 'opencode')
  const roots = new Map<string, string>()
  for (const root of [primary, ...parseExtraRoots(environment)]) {
    const normalized = path.normalize(root)
    roots.set(normalizedKey(normalized), normalized)
  }
  return [...roots.values()]
}

function resolveDbPrefix(environment: NodeJS.ProcessEnv): string {
  return environment['OPENCODE_DB_PREFIX'] || DB_PREFIX
}

function fileSignature(info: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; birthtimeMs: number }): FileSignature {
  return {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    birthtimeMs: info.birthtimeMs,
  }
}

async function safeFileSignature(filePath: string): Promise<FileSignature | null> {
  try {
    const info = await stat(filePath)
    return info.isFile() ? fileSignature(info) : null
  } catch {
    return null
  }
}

async function scanRoot(root: string, prefix: string): Promise<RootSignature> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return { root, exists: false, databases: [] }
  }

  const databases: DatabaseSignature[] = []
  for (const name of entries.sort()) {
    if (!name.startsWith(prefix) || !name.endsWith('.db')) continue
    const databasePath = path.join(root, name)
    const main = await safeFileSignature(databasePath)
    if (!main) continue
    databases.push({
      name,
      main,
      // WAL and rollback-journal metadata are cheap to read and catch both
      // append-only writes and checkpoint/reset transitions. The main DB is
      // never opened or hashed by the detector.
      wal: await safeFileSignature(`${databasePath}-wal`),
      journal: await safeFileSignature(`${databasePath}-journal`),
    })
  }
  return { root, exists: true, databases }
}

async function scanSources(environment: NodeJS.ProcessEnv, now: () => number): Promise<OpenCodeSourceFingerprint> {
  const startedAt = now()
  const roots = resolveRoots(environment)
  const signatures = await Promise.all(roots.map(root => scanRoot(root, resolveDbPrefix(environment))))
  const serialized = JSON.stringify({ version: STATE_VERSION, prefix: resolveDbPrefix(environment), roots: signatures })
  const signature = createHash('sha256').update(serialized).digest('hex')
  const elapsedMs = Math.max(0, Math.round(now() - startedAt))
  trace('opencode-source-fingerprint', {
    rootCount: signatures.length,
    existingRootCount: signatures.filter(root => root.exists).length,
    databaseCount: signatures.reduce((count, root) => count + root.databases.length, 0),
    elapsedMs,
  })
  return {
    signature,
    rootCount: signatures.length,
    existingRootCount: signatures.filter(root => root.exists).length,
    databaseCount: signatures.reduce((count, root) => count + root.databases.length, 0),
    elapsedMs,
  }
}

async function readState(statePath: string): Promise<PersistedFreshnessState | null> {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as Partial<PersistedFreshnessState>
    if (parsed.version !== STATE_VERSION || typeof parsed.signature !== 'string' || typeof parsed.lastSuccessAt !== 'number') return null
    return parsed as PersistedFreshnessState
  } catch {
    return null
  }
}

async function writeState(statePath: string, signature: string, now: () => number): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true })
  const payload: PersistedFreshnessState = { version: STATE_VERSION, signature, lastSuccessAt: now() }
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(temporaryPath, statePath)
    } catch {
      // Windows can reject rename-over-existing-file. The state is a tiny,
      // disposable acknowledgement file, so fall back to replacing it.
      await writeFile(statePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
      await rm(temporaryPath, { force: true })
    }
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

/**
 * Detect OpenCode source changes using metadata only. The standalone data root
 * and the Metrora-owned additive root use the same bounded root contract as
 * the canonical provider, so a WAL append, checkpoint, replacement, or store
 * appearance invalidates the acknowledgement without touching SQLite.
 */
export function createOpenCodeSourceChangeDetector(options: OpenCodeSourceChangeDetectorOptions): OpenCodeSourceChangeDetector {
  const environment = { ...process.env, ...(options.environment ?? {}) }
  const now = options.now ?? (() => performance.now())

  return {
    async check(): Promise<OpenCodeFreshnessSnapshot> {
      const fingerprint = await scanSources(environment, now)
      const persisted = await readState(options.statePath)
      // A machine with no OpenCode store should not launch a needless first
      // reconciliation. Leave the state absent so a store appearing later is
      // still observed as a real change; lastSuccessAt remains success-only.
      return { ...fingerprint, changed: persisted ? persisted.signature !== fingerprint.signature : fingerprint.databaseCount > 0 }
    },

    async commit(snapshot: OpenCodeFreshnessSnapshot): Promise<boolean> {
      const current = await scanSources(environment, now)
      if (current.signature !== snapshot.signature) {
        trace('opencode-source-commit', { committed: false, sourceChanged: true })
        return false
      }
      await writeState(options.statePath, current.signature, () => Date.now())
      trace('opencode-source-commit', { committed: true, sourceChanged: false })
      return true
    },
  }
}

export type OpenCodeFreshnessCoordinator = {
  onSnapshotPoll: () => Promise<void>
  onExplicitFreshSuccess: (provider: string) => Promise<void>
  waitForIdle: () => Promise<void>
}

export type OpenCodeFreshnessCoordinatorOptions = {
  detector: OpenCodeSourceChangeDetector
  reconcile: () => Promise<unknown>
  onSuccess?: () => void
  onError?: (error: unknown) => void
}

/**
 * Single-flight, provider-scoped freshness scheduler. At most one automatic
 * reconciliation is followed immediately when a source changed during it; a
 * second concurrent mutation remains unacknowledged for the next poll rather
 * than creating an unbounded refresh loop.
 */
export function createOpenCodeFreshnessCoordinator(options: OpenCodeFreshnessCoordinatorOptions): OpenCodeFreshnessCoordinator {
  let flight: Promise<void> | null = null
  let requestedWhileRunning = false

  const reportError = (error: unknown): void => {
    try { options.onError?.(error) } catch { /* diagnostics are best-effort */ }
  }

  const drain = async (): Promise<void> => {
    let attempts = 0
    while (attempts < 2) {
      const snapshot = await options.detector.check()
      if (!snapshot.changed) break

      attempts += 1
      trace('opencode-reconciliation-start', { attempt: attempts, databaseCount: snapshot.databaseCount })
      try {
        await options.reconcile()
      } catch (error) {
        reportError(error)
        trace('opencode-reconciliation-finish', { ok: false, attempt: attempts })
        break
      }

      const committed = await options.detector.commit(snapshot)
      try { options.onSuccess?.() } catch { /* cache invalidation is best-effort */ }
      trace('opencode-reconciliation-finish', { ok: true, attempt: attempts, committed })
      if (committed && !requestedWhileRunning) break
      requestedWhileRunning = false
    }
    requestedWhileRunning = false
  }

  const start = (): void => {
    if (flight) return
    flight = drain()
      .catch(reportError)
      .finally(() => { flight = null })
  }

  return {
    async onSnapshotPoll(): Promise<void> {
      try {
        const snapshot = await options.detector.check()
        if (!snapshot.changed) return
        if (flight) {
          requestedWhileRunning = true
          return
        }
        start()
      } catch (error) {
        reportError(error)
      }
    },

    async onExplicitFreshSuccess(provider: string): Promise<void> {
      if (provider !== 'all' && provider !== 'opencode') return
      try {
        const snapshot = await options.detector.check()
        // The explicit fresh read already reconciled OpenCode. A failed commit
        // leaves the latest source signature unacknowledged for the next poll.
        await options.detector.commit(snapshot)
      } catch (error) {
        reportError(error)
      }
      try { options.onSuccess?.() } catch { /* cache invalidation is best-effort */ }
    },

    async waitForIdle(): Promise<void> {
      await flight
    },
  }
}
