// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveStandaloneOpenCodeRuntime } from './standalone'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'metrora-opencode-standalone-'))
  temporaryDirectories.push(directory)
  return directory
}

function successfulProbe() {
  return vi.fn(async (_executable: string, args: string[]) => args[0] === '--version'
    ? { stdout: '1.18.29\n', stderr: '' }
    : { stdout: 'opencode export [sessionID]\n', stderr: '' })
}

describe('standalone OpenCode runtime resolution', () => {
  it('resolves an explicit installed export-capable runtime without consulting PATH', async () => {
    const root = temporaryDirectory()
    const executable = path.join(root, 'opencode.exe')
    const database = path.join(root, 'data', 'opencode', 'opencode.db')
    mkdirSync(path.dirname(database), { recursive: true })
    writeFileSync(executable, 'standalone')
    writeFileSync(database, 'database')
    const probe = successfulProbe()

    await expect(resolveStandaloneOpenCodeRuntime({
      platform: 'win32',
      environment: { PATH: path.join(root, 'old-bin'), OPENCODE_DB: database },
      executableCandidates: [executable],
      databaseCandidates: [database],
      probe,
    })).resolves.toMatchObject({ executablePath: executable, version: '1.18.29', databasePath: database })
    expect(probe).toHaveBeenNthCalledWith(1, executable, ['--version'], expect.any(Object))
    expect(probe).toHaveBeenNthCalledWith(2, executable, ['export', '--help'], expect.any(Object))
  })

  it('finds a Desktop-staged CLI under a portable app-data version directory', async () => {
    const root = temporaryDirectory()
    const appData = path.join(root, 'AppData', 'Roaming')
    const executable = path.join(appData, 'ai.opencode.desktop', 'cli', '1.18.29', 'opencode-cli.exe')
    mkdirSync(path.dirname(executable), { recursive: true })
    writeFileSync(executable, 'desktop cli')
    const probe = successfulProbe()

    await expect(resolveStandaloneOpenCodeRuntime({
      platform: 'win32',
      environment: { APPDATA: appData, LOCALAPPDATA: path.join(root, 'AppData', 'Local') },
      appDataPath: appData,
      localAppDataPath: path.join(root, 'AppData', 'Local'),
      probe,
      fileExists: async filePath => filePath === executable,
    })).resolves.toMatchObject({ executablePath: executable, version: '1.18.29' })
  })

  it('rejects an older runtime even when an executable is present', async () => {
    const root = temporaryDirectory()
    const executable = path.join(root, 'old-opencode.exe')
    writeFileSync(executable, 'old')
    const probe = vi.fn(async () => ({ stdout: '1.14.41\n', stderr: '' }))

    await expect(resolveStandaloneOpenCodeRuntime({
      platform: 'win32',
      executableCandidates: [executable],
      probe,
      fileExists: async filePath => filePath === executable,
    })).resolves.toBeNull()
    expect(probe).toHaveBeenCalledOnce()
  })

  it('rejects a runtime that does not expose the official export command', async () => {
    const root = temporaryDirectory()
    const executable = path.join(root, 'no-export.exe')
    writeFileSync(executable, 'no export')
    const probe = vi.fn(async (_file: string, args: string[]) => args[0] === '--version'
      ? { stdout: '1.18.29', stderr: '' }
      : { stdout: 'Usage: opencode', stderr: '' })

    await expect(resolveStandaloneOpenCodeRuntime({
      platform: 'win32',
      executableCandidates: [executable],
      probe,
      fileExists: async filePath => filePath === executable,
    })).resolves.toBeNull()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('excludes Metrora-owned paths and strips Metrora environment from the standalone command', async () => {
    const root = temporaryDirectory()
    const userData = path.join(root, 'metrora-user-data')
    const standaloneRoot = path.join(root, 'standalone')
    const executable = path.join(standaloneRoot, 'opencode.exe')
    const externalDatabase = path.join(standaloneRoot, 'opencode.db')
    const metroraDatabase = path.join(userData, 'opencode', 'runtime', '1.18.27', 'db', 'opencode.db')
    mkdirSync(path.dirname(externalDatabase), { recursive: true })
    mkdirSync(path.dirname(metroraDatabase), { recursive: true })
    writeFileSync(executable, 'standalone')
    writeFileSync(externalDatabase, 'external')
    writeFileSync(metroraDatabase, 'metrora')
    let probedEnvironment: NodeJS.ProcessEnv | undefined
    const probe = vi.fn(async (_file: string, args: string[], environment: NodeJS.ProcessEnv) => {
      probedEnvironment = environment
      return args[0] === '--version'
        ? { stdout: '1.18.29', stderr: '' }
        : { stdout: 'opencode export <sessionID>', stderr: '' }
    })

    const resolved = await resolveStandaloneOpenCodeRuntime({
      platform: 'win32',
      environment: {
        OPENCODE_DB: metroraDatabase,
        METRORA_USAGE_SNAPSHOT_FILE: 'secret-path',
        ANTHROPIC_API_KEY: 'provider-secret',
      },
      excludedRoots: [userData],
      executableCandidates: [executable],
      databaseCandidates: [metroraDatabase, externalDatabase],
      probe,
      fileExists: async filePath => filePath === executable || filePath === metroraDatabase || filePath === externalDatabase,
    })

    expect(resolved?.databasePath).toBe(externalDatabase)
    expect(resolved?.environment.OPENCODE_DB).toBe(externalDatabase)
    expect(resolved?.environment.METRORA_USAGE_SNAPSHOT_FILE).toBeUndefined()
    expect(resolved?.environment.ANTHROPIC_API_KEY).toBe('provider-secret')
    expect(probedEnvironment?.OPENCODE_DB).toBeUndefined()
  })
})
