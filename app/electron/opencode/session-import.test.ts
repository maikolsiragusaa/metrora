// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runtimePaths } from './config'
import {
  OpenCodeSessionImporter,
  type OpenCodeCommandRequest,
  type OpenCodeCommandResult,
} from './session-import'
import { readOpenCodeSessionMetadata, type OpenCodeSessionMetadata, type OpenCodeSessionMetadataRead } from './storage'

const requireForTest = createRequire(import.meta.url)
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'metrora-opencode-import-'))
  temporaryDirectories.push(directory)
  return directory
}

function session(id: string, directory: string | null): OpenCodeSessionMetadata {
  return { id, title: `Session ${id}`, directory, updatedAt: 1_700_000_000_000 }
}

type HarnessOptions = {
  sourceSessions?: OpenCodeSessionMetadata[]
  destinationSessions?: OpenCodeSessionMetadata[]
  unavailableDirectories?: Set<string>
  exportFailures?: Set<string>
  malformedExports?: Set<string>
  importFailures?: Set<string>
  snapshotFailure?: boolean
  rejectMaintenance?: boolean
}

function harness(options: HarnessOptions = {}) {
  const root = temporaryDirectory()
  const userDataPath = path.join(root, 'metrora-user-data')
  const sourceDatabasePath = path.join(root, 'standalone', 'opencode.db')
  mkdirSync(path.dirname(sourceDatabasePath), { recursive: true })
  writeFileSync(sourceDatabasePath, 'standalone database placeholder')
  const destinationPath = runtimePaths(userDataPath).databasePath
  const sourceSessions = options.sourceSessions ?? [session('new-a', path.join(root, 'project-a'))]
  const destinationSessions = [...(options.destinationSessions ?? [])]
  let destinationExists = destinationSessions.length > 0
  let maintenanceRuns = 0
  let maintenanceCompletions = 0
  const calls: OpenCodeCommandRequest[] = []

  const standalone = {
    executablePath: path.join(root, 'standalone-opencode.exe'),
    version: '1.18.29',
    databasePath: sourceDatabasePath,
    environment: {
      OPENCODE_DB: sourceDatabasePath,
      XDG_DATA_HOME: path.join(root, 'standalone-data'),
    },
  }

  const commandRunner = vi.fn(async (request: OpenCodeCommandRequest): Promise<OpenCodeCommandResult> => {
    calls.push(request)
    const [command, value] = request.args
    if (command === 'export') {
      if (options.exportFailures?.has(value ?? '')) return { code: 1, stderr: 'redacted export failure', timedOut: false }
      const exported = sourceSessions.find(item => item.id === value)
      if (!exported || !request.stdoutPath) return { code: 1, stderr: '', timedOut: false }
      const info = options.malformedExports?.has(value ?? '')
        ? { id: 'wrong-id' }
        : { id: exported.id, title: exported.title, directory: exported.directory }
      writeFileSync(request.stdoutPath, JSON.stringify({ info, messages: [{ info: { id: `message-${value}` }, parts: [] }] }))
      return { code: 0, stderr: '', timedOut: false }
    }
    if (command === 'import') {
      const data = JSON.parse(readFileSync(value!, 'utf8')) as { info: { id: string } }
      if (options.importFailures?.has(data.info.id)) return { code: 1, stderr: 'redacted import failure', timedOut: false }
      const imported = sourceSessions.find(item => item.id === data.info.id)
      if (imported && !destinationSessions.some(item => item.id === imported.id)) destinationSessions.push(imported)
      destinationExists = true
      return { code: 0, stderr: '', timedOut: false }
    }
    return { code: 1, stderr: '', timedOut: false }
  })

  const readSessionMetadata = vi.fn(async (databasePath: string): Promise<OpenCodeSessionMetadataRead> => {
    if (databasePath === sourceDatabasePath) return { kind: 'ok', sessions: sourceSessions }
    if (databasePath === destinationPath) {
      return destinationExists ? { kind: 'ok', sessions: destinationSessions } : { kind: 'missing', sessions: [] }
    }
    return { kind: 'unavailable', sessions: [], detail: 'unexpected database' }
  })
  const importer = new OpenCodeSessionImporter({
    userDataPath,
    platform: process.platform,
    standaloneResolver: async () => standalone,
    readSessionMetadata,
    snapshotDatabase: async (_sourcePath, destinationPath) => {
      if (options.snapshotFailure) throw new Error('snapshot failed')
      writeFileSync(destinationPath, 'owned snapshot placeholder')
    },
    directoryIsAvailable: async directory => !options.unavailableDirectories?.has(directory),
    commandRunner,
    getMetroraCommand: async () => ({
      executablePath: path.join(root, 'metrora-opencode.exe'),
      environment: { OPENCODE_DB: destinationPath, XDG_DATA_HOME: runtimePaths(userDataPath).dataDir },
      paths: runtimePaths(userDataPath),
    }),
    runWithRuntimeStopped: async operation => {
      maintenanceRuns += 1
      if (options.rejectMaintenance) throw new Error('shutdown cancelled')
      try { return await operation() } finally { maintenanceCompletions += 1 }
    },
  })
  return { root, userDataPath, sourceDatabasePath, destinationPath, destinationSessions, calls, commandRunner, readSessionMetadata, importer, maintenanceRuns: () => maintenanceRuns, maintenanceCompletions: () => maintenanceCompletions }
}

describe('OpenCode standalone session import', () => {
  it('reports a missing standalone export runtime without touching Metrora', async () => {
    const root = temporaryDirectory()
    const importer = new OpenCodeSessionImporter({
      userDataPath: path.join(root, 'user-data'),
      standaloneResolver: async () => null,
      getMetroraCommand: async () => { throw new Error('must not be called') },
      runWithRuntimeStopped: async operation => operation(),
    })

    await expect(importer.importNewSessions()).resolves.toMatchObject({
      discovered: 0,
      imported: 0,
      reason: 'standalone-not-found',
      reasons: [],
    })
  })

  it('treats an installed runtime with no standalone database as an empty source', async () => {
    const h = harness()
    const empty = new OpenCodeSessionImporter({
      userDataPath: h.userDataPath,
      standaloneResolver: async () => ({ executablePath: 'standalone', version: '1.18.29', databasePath: null, environment: {} }),
      getMetroraCommand: async () => { throw new Error('must not be called') },
      runWithRuntimeStopped: async operation => operation(),
    })
    await expect(empty.importNewSessions()).resolves.toMatchObject({ discovered: 0, newSessions: 0, imported: 0, reason: null })
  })

  it('counts overlap as already present and leaves existing sessions untouched', async () => {
    const h = harness({
      sourceSessions: [session('a', path.resolve('import-a'))],
      destinationSessions: [session('a', path.resolve('different-a'))],
    })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ discovered: 1, newSessions: 0, imported: 0, alreadyPresent: 1 })
    expect(h.commandRunner).not.toHaveBeenCalled()
    expect(h.maintenanceRuns()).toBe(0)
  })

  it('exports to a private file and imports one new session with its original directory', async () => {
    const h = harness({ sourceSessions: [session('new-a', path.resolve('project-a'))] })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ discovered: 1, newSessions: 1, imported: 1, alreadyPresent: 0 })
    expect(h.calls.map(call => call.args)).toEqual([['export', 'new-a'], ['import', expect.stringMatching(/\.json$/u)]])
    expect(h.calls[0]?.cwd).toBe(path.resolve('project-a'))
    expect(h.calls[1]?.cwd).toBe(path.resolve('project-a'))
    expect(h.calls[0]?.environment.OPENCODE_DB).not.toBe(h.sourceDatabasePath)
    expect(h.calls[0]?.environment.OPENCODE_CONFIG_DIR).toBeUndefined()
    expect(h.calls[0]?.environment.OPENCODE_CONFIG).toBeUndefined()
    expect(h.calls[1]?.environment.OPENCODE_DB).toBe(h.destinationPath)
    expect(readdirSync(path.join(h.userDataPath, 'temp', 'opencode-session-import'))).toEqual([])
    expect(h.maintenanceRuns()).toBe(1)
    expect(h.maintenanceCompletions()).toBe(1)
  })

  it('imports multiple sessions, skips canonical overlaps, and does not update an existing directory', async () => {
    const h = harness({
      sourceSessions: [session('a', path.resolve('a')), session('b', path.resolve('b')), session('c', path.resolve('c'))],
      destinationSessions: [session('a', path.resolve('old-a'))],
    })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ discovered: 3, newSessions: 2, imported: 2, alreadyPresent: 1 })
    expect(h.calls.filter(call => call.args[0] === 'export').map(call => call.args[1])).toEqual(['b', 'c'])
    expect(h.destinationSessions.find(item => item.id === 'a')?.directory).toBe(path.resolve('old-a'))
  })

  it('is idempotent across the second invocation', async () => {
    const h = harness({ sourceSessions: [session('new-a', path.resolve('project-a'))] })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ imported: 1 })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ newSessions: 0, imported: 0, alreadyPresent: 1 })
    expect(h.calls.filter(call => call.args[0] === 'import')).toHaveLength(1)
  })

  it('skips a missing or unsafe project directory without inventing a path', async () => {
    const missing = session('missing', path.join('relative', 'project'))
    const noDirectory = session('none', null)
    const h = harness({ sourceSessions: [missing, noDirectory] })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ newSessions: 2, skipped: 2, failed: 0, reason: 'directory-unavailable' })
    expect(h.commandRunner).not.toHaveBeenCalled()
  })

  it('continues after one standalone export fails', async () => {
    const h = harness({
      sourceSessions: [session('failed', path.resolve('failed')), session('ok', path.resolve('ok'))],
      exportFailures: new Set(['failed']),
    })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ newSessions: 2, imported: 1, failed: 1, skipped: 0 })
    expect(h.calls.filter(call => call.args[0] === 'import').map(call => call.args[1])).toHaveLength(1)
  })

  it('fails all export candidates safely when the read-only source snapshot cannot be created', async () => {
    const h = harness({ sourceSessions: [session('new-a', path.resolve('project-a'))], snapshotFailure: true })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ newSessions: 1, imported: 0, failed: 1, reason: 'export-unavailable' })
    expect(h.commandRunner).not.toHaveBeenCalled()
    expect(readdirSync(path.join(h.userDataPath, 'temp', 'opencode-session-import'))).toEqual([])
  })

  it('classifies a malformed export as incompatible and continues', async () => {
    const h = harness({
      sourceSessions: [session('bad', path.resolve('bad')), session('ok', path.resolve('ok'))],
      malformedExports: new Set(['bad']),
    })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ imported: 1, skipped: 1, failed: 0, reason: 'incompatible-export' })
  })

  it('continues after one pinned-runtime import fails', async () => {
    const h = harness({
      sourceSessions: [session('failed', path.resolve('failed')), session('ok', path.resolve('ok'))],
      importFailures: new Set(['failed']),
    })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ imported: 1, failed: 1, skipped: 0 })
    expect(h.calls.filter(call => call.args[0] === 'import')).toHaveLength(2)
  })

  it('cleans the sensitive export file after an export or import failure', async () => {
    const h = harness({ sourceSessions: [session('failed', path.resolve('failed'))], importFailures: new Set(['failed']) })
    await h.importer.importNewSessions()
    const exportPath = h.calls.find(call => call.args[0] === 'export')?.stdoutPath
    expect(exportPath).toBeTruthy()
    expect(() => readFileSync(exportPath!, 'utf8')).toThrow()
  })

  it('never runs two imports concurrently', async () => {
    const h = harness({ sourceSessions: [session('new-a', path.resolve('project-a'))] })
    h.readSessionMetadata.mockImplementation(async databasePath => databasePath === h.sourceDatabasePath
      ? { kind: 'ok', sessions: [session('new-a', path.resolve('project-a'))] }
      : { kind: 'ok', sessions: h.destinationSessions })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    h.commandRunner.mockImplementation(async request => {
      if (request.args[0] === 'export') {
        await gate
        const exported = { info: { id: request.args[1] }, messages: [] }
        if (request.stdoutPath) writeFileSync(request.stdoutPath, JSON.stringify(exported))
      } else {
        h.destinationSessions.push(session('new-a', path.join(h.root, 'project-a')))
      }
      return { code: 0, stderr: '', timedOut: false }
    })
    const first = h.importer.importNewSessions()
    const second = h.importer.importNewSessions()
    expect(first).toBe(second)
    release()
    await expect(first).resolves.toMatchObject({ imported: 1 })
    expect(h.maintenanceRuns()).toBe(1)
  })

  it('cancels an in-flight import and reports only the uncommitted candidate as cancelled', async () => {
    const h = harness({ sourceSessions: [session('new-a', path.resolve('project-a'))] })
    let started!: () => void
    const commandStarted = new Promise<void>(resolve => { started = resolve })
    let release!: () => void
    const commandGate = new Promise<void>(resolve => { release = resolve })
    h.commandRunner.mockImplementation(async request => {
      started()
      await commandGate
      if (request.args[0] === 'export' && request.stdoutPath) {
        writeFileSync(request.stdoutPath, JSON.stringify({ info: { id: 'new-a' }, messages: [] }))
      }
      return { code: 0, stderr: '', timedOut: false }
    })

    const pending = h.importer.importNewSessions()
    await commandStarted
    h.importer.cancel()
    release()

    await expect(pending).resolves.toMatchObject({ imported: 0, failed: 1, reason: 'cancelled' })
    expect(h.maintenanceCompletions()).toBe(1)
  })

  it('reports cancellation when shutdown prevents the maintenance window', async () => {
    const h = harness({ sourceSessions: [session('new-a', path.resolve('project-a'))], rejectMaintenance: true })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ newSessions: 1, imported: 0, failed: 1, reason: 'cancelled' })
  })

  it('rejects a corrupt destination before running any standalone command', async () => {
    const h = harness({ sourceSessions: [session('new-a', path.resolve('project-a'))] })
    h.readSessionMetadata.mockImplementation(async databasePath => databasePath === h.sourceDatabasePath
      ? { kind: 'ok', sessions: [session('new-a', path.resolve('project-a'))] }
      : { kind: 'unavailable', sessions: [], detail: 'corrupt destination' })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ reason: 'import-failed', imported: 0, failed: 0 })
    expect(h.commandRunner).not.toHaveBeenCalled()
  })

  it('deduplicates repeated source IDs before exporting', async () => {
    const h = harness({ sourceSessions: [session('same', path.resolve('a')), session('same', path.resolve('b'))] })
    await expect(h.importer.importNewSessions()).resolves.toMatchObject({ discovered: 1, newSessions: 1, imported: 1 })
    expect(h.calls.filter(call => call.args[0] === 'export')).toHaveLength(1)
  })
})

describe('OpenCode metadata-only discovery', () => {
  it('does not deserialize message or part payloads while reading IDs and directory metadata', async () => {
    const root = temporaryDirectory()
    const databasePath = path.join(root, 'opencode.db')
    const DatabaseSync = (requireForTest('node:sqlite') as { DatabaseSync: new (filePath: string) => { exec(sql: string): void; close(): void } }).DatabaseSync
    const database = new DatabaseSync(databasePath)
    database.exec([
      'CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_updated INTEGER)',
      'CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)',
      'CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT)',
      "INSERT INTO session VALUES ('session-1', 'A title', '/safe/project', 1700000000000)",
      "INSERT INTO message VALUES ('message-1', 'session-1', 'not JSON and intentionally not inspected')",
      "INSERT INTO part VALUES ('part-1', 'message-1', 'session-1', 'also not JSON')",
    ].join(';'))
    database.close()

    await expect(readOpenCodeSessionMetadata(databasePath)).resolves.toEqual({
      kind: 'ok',
      sessions: [{ id: 'session-1', title: 'A title', directory: '/safe/project', updatedAt: 1700000000000 }],
    })
  })
})
