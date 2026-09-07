// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runtimePaths } from './config'
import { OpenCodeRuntime, type OpenCodeFetch, type SpawnedOpenCodeProcess } from './runtime'
import { prepareOpenCodeStorage, quarantineImportedOpenCodeDatabase } from './storage'
import { OPENCODE_CUSTOM_TOOL_IDS, OPENCODE_VERSION } from './types'

const storageTestControls = vi.hoisted(() => ({
  largePaths: new Set<string>(),
  availableBytes: null as bigint | null,
}))

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    stat: async (filePath: any, options?: any) => {
      const value = await original.stat(filePath, options)
      if (storageTestControls.largePaths.has(String(filePath))) {
        Object.defineProperty(value, 'size', { configurable: true, value: (512 * 1024 * 1024) + 1 })
      }
      return value
    },
    statfs: async (filePath: any, options?: any) => {
      if (storageTestControls.availableBytes === null) return original.statfs(filePath, options)
      const blockSize = 4096n
      const availableBlocks = storageTestControls.availableBytes / blockSize
      return {
        type: 0n,
        bsize: blockSize,
        blocks: availableBlocks,
        bfree: availableBlocks,
        bavail: availableBlocks,
        files: 1n,
        ffree: 1n,
      }
    },
  }
})

type TestDatabase = {
  exec(sql: string): void
  prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>> }
  close(): void
}

const requireForTest = createRequire(import.meta.url)
const { DatabaseSync } = requireForTest('node:sqlite') as { DatabaseSync: new (filePath: string, options?: { readOnly?: boolean }) => TestDatabase }
const temporaryDirectories: string[] = []

afterEach(() => {
  storageTestControls.largePaths.clear()
  storageTestControls.availableBytes = null
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-storage-'))
  temporaryDirectories.push(directory)
  return directory
}

function fingerprint(filePath: string): { hash: string; mtimeMs: number } {
  return {
    hash: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
    mtimeMs: statSync(filePath).mtimeMs,
  }
}

function createExternalDatabase(root: string): { path: string; database: TestDatabase } {
  const dataHome = join(root, 'external-data')
  const directory = join(dataHome, 'opencode')
  mkdirSync(directory, { recursive: true })
  const filePath = join(directory, 'opencode.db')
  const database = new DatabaseSync(filePath)
  database.exec('PRAGMA journal_mode = WAL; CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES (\'external-authority\'); PRAGMA user_version = 1162;')
  return { path: filePath, database }
}

function fakeChild(): SpawnedOpenCodeProcess {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const child = {
    exitCode: null as number | null,
    once(event: 'exit' | 'error', listener: (...args: unknown[]) => void) {
      const current = listeners.get(event) ?? new Set()
      current.add(listener)
      listeners.set(event, current)
      return child
    },
    removeListener(event: 'exit' | 'error', listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener)
      return child
    },
    kill() {
      child.exitCode = 0
      for (const listener of listeners.get('exit') ?? []) listener()
      return true
    },
  }
  return child
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('Metrora-owned OpenCode storage continuity', () => {
  it('treats an existing Metrora database above the former external import threshold as existing', async () => {
    const root = tempDirectory()
    const userDataPath = join(root, 'metrora-user-data')
    const paths = runtimePaths(userDataPath)
    mkdirSync(paths.dbDir, { recursive: true })
    writeFileSync(paths.databasePath, 'Metrora-owned database')
    storageTestControls.largePaths.add(paths.databasePath)

    await expect(prepareOpenCodeStorage(paths, { userDataPath })).resolves.toEqual({ outcome: 'existing' })
  })

  it('starts with an existing Metrora database above the former external import threshold', async () => {
    const root = tempDirectory()
    const userDataPath = join(root, 'metrora-user-data')
    const paths = runtimePaths(userDataPath)
    mkdirSync(paths.dbDir, { recursive: true })
    writeFileSync(paths.databasePath, 'Metrora-owned database')
    storageTestControls.largePaths.add(paths.databasePath)
    const executable = join(root, 'opencode.exe')
    writeFileSync(executable, 'official binary placeholder')
    const runtime = new OpenCodeRuntime({
      appPath: root,
      resourcesPath: root,
      userDataPath,
      isPackaged: false,
      baseEnv: {},
      executableOverride: executable,
      acquirePort: async () => 43123,
      isLoopbackPortAvailable: async () => true,
      spawnProcess: () => fakeChild(),
      fetchImpl: async url => url.endsWith('/global/health')
        ? jsonResponse({ healthy: true, version: OPENCODE_VERSION })
        : jsonResponse([...OPENCODE_CUSTOM_TOOL_IDS]),
      healthTimeoutMs: 500,
      pollIntervalMs: 1,
    })

    await expect(runtime.start()).resolves.toMatchObject({ state: 'ready', customToolRegistered: true })
    await runtime.stop()
  })

  it('skips external import truthfully when the owned runtime lacks disk headroom', async () => {
    const root = tempDirectory()
    const external = createExternalDatabase(root)
    const userDataPath = join(root, 'metrora-user-data')
    const paths = runtimePaths(userDataPath)
    const beforeMain = fingerprint(external.path)
    const beforeWal = existsSync(`${external.path}-wal`) ? fingerprint(`${external.path}-wal`) : null
    storageTestControls.availableBytes = 4096n

    try {
      await expect(prepareOpenCodeStorage(paths, {
        userDataPath,
        environment: { XDG_DATA_HOME: join(root, 'external-data') },
      })).resolves.toMatchObject({
        outcome: 'failed',
        sourcePath: external.path,
        detail: expect.stringContaining('external OpenCode import needs'),
      })
      expect(fingerprint(external.path)).toEqual(beforeMain)
      expect(beforeWal && fingerprint(`${external.path}-wal`)).toEqual(beforeWal)
      expect(existsSync(paths.databasePath)).toBe(false)
    } finally {
      external.database.close()
    }
  })

  it('imports a stable read-only snapshot without touching the external database', async () => {
    const root = tempDirectory()
    const external = createExternalDatabase(root)
    const userDataPath = join(root, 'metrora-user-data')
    const paths = runtimePaths(userDataPath)
    const beforeMain = fingerprint(external.path)
    const beforeWal = existsSync(`${external.path}-wal`) ? fingerprint(`${external.path}-wal`) : null

    await expect(prepareOpenCodeStorage(paths, {
      userDataPath,
      environment: { XDG_DATA_HOME: join(root, 'external-data') },
    })).resolves.toMatchObject({ outcome: 'imported', sourcePath: external.path })

    expect(fingerprint(external.path)).toEqual(beforeMain)
    expect(beforeWal && fingerprint(`${external.path}-wal`)).toEqual(beforeWal)
    expect(paths.databasePath).not.toBe(external.path)
    expect(existsSync(paths.databasePath)).toBe(true)
    expect(existsSync(`${paths.databasePath}-wal`)).toBe(Boolean(beforeWal))
    expect(existsSync(`${paths.databasePath}-shm`)).toBe(false)

    const imported = new DatabaseSync(paths.databasePath, { readOnly: true })
    expect(imported.prepare('SELECT value FROM sentinel').all()).toEqual([{ value: 'external-authority' }])
    expect(imported.prepare('PRAGMA user_version').all()).toEqual([{ user_version: 1162 }])
    imported.close()
    external.database.close()
  })

  it('imports without depending on the non-portable DatabaseSync.serialize API', async () => {
    const root = tempDirectory()
    const external = createExternalDatabase(root)
    const userDataPath = join(root, 'metrora-user-data')
    const paths = runtimePaths(userDataPath)
    const sqlitePrototype = (DatabaseSync as unknown as { prototype: TestDatabase & { serialize?: unknown } }).prototype
    const originalSerialize = sqlitePrototype.serialize
    try {
      sqlitePrototype.serialize = undefined
      await expect(prepareOpenCodeStorage(paths, {
        userDataPath,
        environment: { XDG_DATA_HOME: join(root, 'external-data') },
      })).resolves.toMatchObject({ outcome: 'imported' })
      expect(existsSync(paths.databasePath)).toBe(true)
    } finally {
      sqlitePrototype.serialize = originalSerialize
      external.database.close()
    }
  })

  it('reuses the Metrora-owned database across restart and never chooses it as a legacy source', async () => {
    const root = tempDirectory()
    const external = createExternalDatabase(root)
    const userDataPath = join(root, 'metrora-user-data')
    const paths = runtimePaths(userDataPath)
    const environment = { XDG_DATA_HOME: join(root, 'external-data') }

    await expect(prepareOpenCodeStorage(paths, { userDataPath, environment })).resolves.toMatchObject({ outcome: 'imported' })
    const importedBeforeRestart = fingerprint(paths.databasePath)
    await expect(prepareOpenCodeStorage(paths, { userDataPath, environment })).resolves.toEqual({ outcome: 'existing' })
    expect(fingerprint(paths.databasePath)).toEqual(importedBeforeRestart)
    expect(external.path).not.toBe(paths.databasePath)
    external.database.close()
  })

  it('starts and stops with isolated launch paths while an external version-skewed store is live', async () => {
    const root = tempDirectory()
    const external = createExternalDatabase(root)
    external.database.exec('PRAGMA user_version = 9999;')
    const beforeMain = fingerprint(external.path)
    const beforeWal = existsSync(`${external.path}-wal`) ? fingerprint(`${external.path}-wal`) : null
    const userDataPath = join(root, 'metrora-user-data')
    const executable = join(root, 'opencode.exe')
    writeFileSync(executable, 'official binary placeholder')
    let launchEnvironment: NodeJS.ProcessEnv | undefined
    const spawnProcess = vi.fn((_file: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      launchEnvironment = options.env
      return fakeChild()
    })
    const fetchImpl: OpenCodeFetch = async url => url.endsWith('/global/health')
      ? jsonResponse({ healthy: true, version: OPENCODE_VERSION })
      : jsonResponse([...OPENCODE_CUSTOM_TOOL_IDS])
    const runtime = new OpenCodeRuntime({
      appPath: root,
      resourcesPath: root,
      userDataPath,
      isPackaged: false,
      executableOverride: executable,
      baseEnv: {
        OPENCODE_DB: external.path,
        XDG_DATA_HOME: join(root, 'external-data'),
        XDG_CACHE_HOME: join(root, 'external-cache'),
        XDG_STATE_HOME: join(root, 'external-state'),
        XDG_CONFIG_HOME: join(root, 'external-config'),
      },
      spawnProcess,
      fetchImpl,
      acquirePort: async () => 43144,
      healthTimeoutMs: 500,
      pollIntervalMs: 1,
    })

    await expect(runtime.start()).resolves.toMatchObject({ state: 'ready' })
    const paths = runtimePaths(userDataPath)
    expect(launchEnvironment?.OPENCODE_DB).toBe(paths.databasePath)
    expect(launchEnvironment?.XDG_DATA_HOME).toBe(paths.dataDir)
    expect(launchEnvironment?.XDG_CACHE_HOME).toBe(paths.cacheDir)
    expect(launchEnvironment?.XDG_STATE_HOME).toBe(paths.stateDir)
    expect(launchEnvironment?.XDG_CONFIG_HOME).toBe(paths.runtimeDir)
    expect(launchEnvironment?.OPENCODE_DB).not.toBe(external.path)

    await runtime.stop()
    expect(fingerprint(external.path)).toEqual(beforeMain)
    expect(beforeWal && fingerprint(`${external.path}-wal`)).toEqual(beforeWal)
    external.database.close()
  })

  it('fails closed for an unreadable external store without blocking a clean isolated store', async () => {
    const root = tempDirectory()
    const externalDirectory = join(root, 'external-data', 'opencode')
    mkdirSync(externalDirectory, { recursive: true })
    const externalPath = join(externalDirectory, 'opencode.db')
    writeFileSync(externalPath, 'not-a-sqlite-database')
    const before = fingerprint(externalPath)
    const userDataPath = join(root, 'metrora-user-data')
    const paths = runtimePaths(userDataPath)

    await expect(prepareOpenCodeStorage(paths, {
      userDataPath,
      environment: { XDG_DATA_HOME: join(root, 'external-data') },
    })).resolves.toMatchObject({ outcome: 'failed', sourcePath: externalPath })
    expect(fingerprint(externalPath)).toEqual(before)
    expect(existsSync(paths.databasePath)).toBe(false)
  })

  it('quarantines only an imported Metrora-owned database before a clean retry', async () => {
    const root = tempDirectory()
    const paths = runtimePaths(join(root, 'metrora-user-data'))
    mkdirSync(paths.dbDir, { recursive: true })
    writeFileSync(paths.databasePath, 'owned-import')

    const rejectedPath = await quarantineImportedOpenCodeDatabase(paths)

    expect(rejectedPath).toBeTruthy()
    expect(existsSync(paths.databasePath)).toBe(false)
    expect(readFileSync(rejectedPath!, 'utf8')).toBe('owned-import')
  })
})
