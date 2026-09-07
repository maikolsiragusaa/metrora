// @vitest-environment node
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { resolveStandaloneOpenCodeRuntime } from './standalone'

const WINDOWS_FIXTURE_ROOT = 'C:\\fixture\\metrora-opencode-standalone'

function fixturePath(...segments: string[]): string {
  return path.win32.join(WINDOWS_FIXTURE_ROOT, ...segments)
}

function successfulProbe() {
  return vi.fn(async (_executable: string, args: string[]) => args[0] === '--version'
    ? { stdout: '1.18.29\n', stderr: '' }
    : { stdout: 'opencode export [sessionID]\n', stderr: '' })
}

describe('standalone OpenCode runtime resolution', () => {
  it('resolves an explicit installed export-capable runtime without consulting PATH', async () => {
    const executable = fixturePath('explicit', 'opencode.exe')
    const database = fixturePath('explicit', 'data', 'opencode', 'opencode.db')
    const probe = successfulProbe()

    await expect(resolveStandaloneOpenCodeRuntime({
      platform: 'win32',
      environment: { PATH: fixturePath('explicit', 'old-bin'), OPENCODE_DB: database },
      executableCandidates: [executable],
      databaseCandidates: [database],
      probe,
      fileExists: async filePath => filePath === executable || filePath === database,
    })).resolves.toMatchObject({ executablePath: executable, version: '1.18.29', databasePath: database })
    expect(probe).toHaveBeenNthCalledWith(1, executable, ['--version'], expect.any(Object))
    expect(probe).toHaveBeenNthCalledWith(2, executable, ['export', '--help'], expect.any(Object))
  })

  it('finds a Desktop-staged CLI under a portable app-data version directory', async () => {
    const appData = fixturePath('desktop', 'AppData', 'Roaming')
    const localAppData = fixturePath('desktop', 'AppData', 'Local')
    const cliRoot = path.win32.join(appData, 'ai.opencode.desktop', 'cli')
    const executable = path.win32.join(cliRoot, '1.18.29', 'opencode-cli.exe')
    const probe = successfulProbe()

    await expect(resolveStandaloneOpenCodeRuntime({
      platform: 'win32',
      environment: { APPDATA: appData, LOCALAPPDATA: localAppData },
      appDataPath: appData,
      localAppDataPath: localAppData,
      probe,
      fileExists: async filePath => filePath === executable,
      readDirectory: async directory => directory === cliRoot ? ['1.18.29'] : [],
    })).resolves.toMatchObject({ executablePath: executable, version: '1.18.29' })
  })

  it('rejects an older runtime even when an executable is present', async () => {
    const executable = fixturePath('older', 'old-opencode.exe')
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
    const executable = fixturePath('no-export', 'opencode.exe')
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
    const userData = fixturePath('excluded', 'metrora-user-data')
    const standaloneRoot = fixturePath('excluded', 'standalone')
    const executable = path.win32.join(standaloneRoot, 'opencode.exe')
    const externalDatabase = path.win32.join(standaloneRoot, 'opencode.db')
    const metroraDatabase = path.win32.join(userData, 'opencode', 'runtime', '1.18.27', 'db', 'opencode.db')
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
