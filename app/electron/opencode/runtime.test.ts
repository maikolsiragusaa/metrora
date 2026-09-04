// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runtimePaths } from './config'
import { buildOpenCodeServerArgs, createLaunchEnvironment, OpenCodeRuntime, resolveOpenCodeExecutable, type OpenCodeFetch, type SpawnedOpenCodeProcess } from './runtime'
import { OPENCODE_COMMIT, OPENCODE_CUSTOM_TOOL_ID, OPENCODE_VERSION } from './types'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-runtime-'))
  temporaryDirectories.push(directory)
  return directory
}

function fakeChild(): SpawnedOpenCodeProcess & { killed: boolean } {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const child = {
    exitCode: null as number | null,
    killed: false,
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
      child.killed = true
      child.exitCode = 0
      for (const listener of listeners.get('exit') ?? []) listener()
      return true
    },
  }
  return child
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('OpenCode upstream sidecar runtime', () => {
  it('resolves only the deterministic staged path and pins the release', () => {
    const root = tempDirectory()
    const staged = join(root, 'build', 'opencode', OPENCODE_VERSION, 'win32-x64', 'opencode.exe')
    mkdirSync(join(root, 'build', 'opencode', OPENCODE_VERSION, 'win32-x64'), { recursive: true })
    writeFileSync(staged, 'official binary placeholder')

    expect(resolveOpenCodeExecutable({ appPath: root, resourcesPath: join(root, 'resources'), isPackaged: false, platform: 'win32', arch: 'x64' })).toBe(staged)
    expect(resolveOpenCodeExecutable({ appPath: root, resourcesPath: join(root, 'resources'), isPackaged: true, platform: 'win32', arch: 'x64' })).toBeNull()
    expect(resolveOpenCodeExecutable({ appPath: root, resourcesPath: root, isPackaged: false, executableOverride: 'relative.exe' })).toBeNull()
    expect(OPENCODE_VERSION).toBe('1.18.27')
    expect(OPENCODE_COMMIT).toBe('b04697366f05419e9bd7a92f841813dd976161c9')
  })

  it('starts serve on loopback with per-launch auth, verifies health/tool discovery, and exposes no secret in status', async () => {
    const root = tempDirectory()
    const userData = join(root, 'user-data')
    const executable = join(root, 'opencode.exe')
    writeFileSync(executable, 'official binary placeholder')
    const child = fakeChild()
    const spawnProcess = vi.fn(() => child)
    const requests: Array<{ url: string; authorization: string }> = []
    const fetchImpl: OpenCodeFetch = async (url, init) => {
      requests.push({ url, authorization: init?.headers?.Authorization ?? '' })
      return url.endsWith('/global/health')
        ? jsonResponse({ healthy: true, version: OPENCODE_VERSION })
        : jsonResponse([OPENCODE_CUSTOM_TOOL_ID])
    }
    const runtime = new OpenCodeRuntime({
      appPath: root,
      resourcesPath: root,
      userDataPath: userData,
      isPackaged: false,
      executableOverride: executable,
      acquirePort: async () => 43127,
      randomPassword: () => 'p'.repeat(64),
      spawnProcess,
      fetchImpl,
      readUsageSnapshot: async () => ({
        generated: '2026-09-04T10:00:00.000Z',
        prompt: 'must not cross the boundary',
        current: {
          cost: 4.25,
          calls: 3,
          sessions: 2,
          inputTokens: 100,
          outputTokens: 40,
          providerDetails: [{ id: 'codex', label: 'Codex', cost: 4.25 }],
        },
      }),
      healthTimeoutMs: 500,
      pollIntervalMs: 1,
    })

    await expect(runtime.start()).resolves.toMatchObject({ state: 'ready', version: OPENCODE_VERSION, commit: OPENCODE_COMMIT, customToolRegistered: true })
    expect(spawnProcess).toHaveBeenCalledWith(
      executable,
      ['serve', '--hostname', '127.0.0.1', '--port', '43127'],
      expect.objectContaining({
        cwd: root,
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
        env: expect.objectContaining({
          OPENCODE_SERVER_USERNAME: 'metrora',
          OPENCODE_SERVER_PASSWORD: 'p'.repeat(64),
          OPENCODE_CONFIG_DIR: join(userData, 'opencode', OPENCODE_VERSION),
          OPENCODE_CONFIG: join(userData, 'opencode', OPENCODE_VERSION, 'opencode.json'),
          OPENCODE_DISABLE_AUTOUPDATE: '1',
        }),
      }),
    )
    expect(requests).toEqual([
      { url: 'http://127.0.0.1:43127/global/health', authorization: expect.stringMatching(/^Basic /u) },
      { url: 'http://127.0.0.1:43127/experimental/tool/ids', authorization: expect.stringMatching(/^Basic /u) },
    ])
    expect(requests[0]?.authorization).toBe(requests[1]?.authorization)
    const status = runtime.status()
    expect(JSON.stringify(status)).not.toContain('43127')
    expect(JSON.stringify(status)).not.toContain('p'.repeat(64))
    const paths = runtimePaths(userData)
    expect(existsSync(join(paths.runtimeDir, 'node_modules'))).toBe(true)
    const runtimePackage = JSON.parse(readFileSync(join(paths.runtimeDir, 'package.json'), 'utf8')) as { type?: string; dependencies?: Record<string, string> }
    const runtimeLock = JSON.parse(readFileSync(join(paths.runtimeDir, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { dependencies?: Record<string, string> }> }
    expect(runtimePackage.type).toBe('module')
    expect(runtimePackage.dependencies?.['@opencode-ai/plugin']).toBe(OPENCODE_VERSION)
    expect(runtimeLock.packages?.['']?.dependencies?.['@opencode-ai/plugin']).toBe(OPENCODE_VERSION)
    expect(readFileSync(join(paths.toolsDir, `${OPENCODE_CUSTOM_TOOL_ID}.js`), 'utf8')).toContain('METRORA_USAGE_SNAPSHOT_FILE')
    const snapshot = readFileSync(paths.snapshotPath, 'utf8')
    expect(snapshot).toContain('metrora.usage-snapshot.v1')
    expect(snapshot).not.toContain('must not cross the boundary')
    expect(snapshot).not.toContain('prompt')

    await runtime.stop()
    expect(child.killed).toBe(true)
    expect(runtime.status()).toMatchObject({ state: 'idle', customToolRegistered: null })
  })

  it('fails closed when the healthy server reports a different version', async () => {
    const root = tempDirectory()
    const executable = join(root, 'opencode')
    writeFileSync(executable, 'official binary placeholder')
    const child = fakeChild()
    const runtime = new OpenCodeRuntime({
      appPath: root,
      resourcesPath: root,
      userDataPath: join(root, 'user-data'),
      isPackaged: false,
      executableOverride: executable,
      acquirePort: async () => 43128,
      spawnProcess: () => child,
      fetchImpl: async () => jsonResponse({ healthy: true, version: '9.9.9' }),
      healthTimeoutMs: 500,
      pollIntervalMs: 1,
    })

    await expect(runtime.start()).resolves.toMatchObject({ state: 'unavailable', customToolRegistered: null })
    expect(runtime.status().detail).toContain(OPENCODE_VERSION)
    expect(child.killed).toBe(true)
  })

  it('rejects invalid ports before constructing a server command', () => {
    expect(buildOpenCodeServerArgs(43129)).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '43129'])
    expect(() => buildOpenCodeServerArgs(0)).toThrow()
    const paths = runtimePaths('C:/user-data')
    const environment = createLaunchEnvironment({ paths, username: 'metrora', password: 'x'.repeat(64), baseEnv: {} })
    expect(environment.OPENCODE_SERVER_PASSWORD).toBe('x'.repeat(64))
    expect(environment.OPENCODE_CONFIG).toBe(paths.configPath)
  })
})
