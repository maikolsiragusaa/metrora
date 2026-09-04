// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createOpenCodeBridgeHandlers,
  projectMetroraUsageSnapshot,
  projectOpenCodeEventForRenderer,
  redactOpenCodeText,
  resolveOpenCodeExecutable,
  OpenCodeEngine,
} from './opencode'
import { OPENCODE_COMMIT, OPENCODE_CUSTOM_TOOL_ID, OPENCODE_VERSION } from './opencode-types'

const tempDirectories: string[] = []

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('OpenCode renderer boundary', () => {
  it('redacts credentials, bearer values, and local paths from event text', () => {
    const value = redactOpenCodeText('token=secret123 bearer abc123 C:\\Users\\founder\\repo\\secret.ts')

    expect(value).not.toContain('secret123')
    expect(value).not.toContain('abc123')
    expect(value).not.toContain('C:\\Users')
    expect(value).toContain('[redacted]')
  })

  it('projects only bounded OpenCode event fields and recovers nested message session ids', () => {
    const delta = projectOpenCodeEventForRenderer({
      type: 'message.part.updated',
      properties: {
        sessionID: 'session-1',
        delta: 'safe answer token=secret',
        part: { id: 'part-1', messageID: 'message-1', type: 'text' },
      },
    })
    expect(delta).toEqual({
      kind: 'message-delta',
      sessionId: 'session-1',
      messageId: 'message-1',
      partId: 'part-1',
      text: 'safe answer [redacted]',
    })

    const message = projectOpenCodeEventForRenderer({
      type: 'message.updated',
      properties: {
        info: { id: 'message-2', sessionID: 'session-2', role: 'assistant', time: { completed: true } },
        input: 'raw provider input must not cross the boundary',
      },
    })
    expect(message).toEqual({ kind: 'message-updated', sessionId: 'session-2', messageId: 'message-2', role: 'assistant', finished: true })
    expect(JSON.stringify(message)).not.toContain('raw provider input')

    const tool = projectOpenCodeEventForRenderer({
      type: 'message.part.updated',
      properties: {
        sessionID: 'session-1',
        part: { id: 'part-2', messageID: 'message-1', type: 'tool', tool: OPENCODE_CUSTOM_TOOL_ID, state: { status: 'completed', input: { secret: 'no' }, output: 'private output' } },
      },
    })
    expect(tool).toEqual({ kind: 'tool', sessionId: 'session-1', messageId: 'message-1', partId: 'part-2', tool: OPENCODE_CUSTOM_TOOL_ID, status: 'completed', title: null })
    expect(JSON.stringify(tool)).not.toContain('private output')
    expect(JSON.stringify(tool)).not.toContain('secret')
  })
})

describe('OpenCode Metrora tool projection', () => {
  it('keeps the usage snapshot read-only and strips secrets and paths', () => {
    const projected = projectMetroraUsageSnapshot({
      cost: 12.34,
      apiKey: 'do-not-expose',
      path: 'C:\\Users\\founder\\repo',
      nested: { authorization: 'Bearer do-not-expose', calls: 4 },
    }, '2026-09-04T00:00:00.000Z')

    expect(projected).toMatchObject({
      schemaVersion: 'metrora.usage-snapshot.v1',
      generatedAt: '2026-09-04T00:00:00.000Z',
      data: { cost: 12.34, apiKey: '[redacted]', path: '[redacted]', nested: { authorization: '[redacted]', calls: 4 } },
    })
    expect(JSON.stringify(projected)).not.toContain('do-not-expose')
    expect(JSON.stringify(projected)).not.toContain('C:\\Users')
  })
})

describe('OpenCode executable and IPC boundaries', () => {
  it('resolves only an absolute staged executable and preserves the pinned identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'metrora-opencode-test-'))
    tempDirectories.push(root)
    const executable = join(root, 'opencode.exe')
    writeFileSync(executable, 'test executable')

    expect(resolveOpenCodeExecutable({
      appPath: root,
      resourcesPath: root,
      isPackaged: false,
      platform: 'win32',
      arch: 'x64',
      executableOverride: executable,
    })).toBe(executable)
    expect(resolveOpenCodeExecutable({
      appPath: root,
      resourcesPath: root,
      isPackaged: false,
      platform: 'win32',
      arch: 'x64',
      executableOverride: 'opencode.exe',
    })).toBeNull()
    expect(OPENCODE_VERSION).toBe('1.18.27')
    expect(OPENCODE_COMMIT).toBe('b04697366f05419e9bd7a92f841813dd976161c9')
  })

  it('launches the pinned server through the loopback health/API boundary and shuts it down cleanly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'metrora-opencode-lifecycle-'))
    tempDirectories.push(root)
    const executable = join(root, 'opencode.exe')
    writeFileSync(executable, 'test executable')

    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; pid: number; kill: () => boolean }
    child.stdout = Readable.from([])
    child.stderr = Readable.from([])
    const stdoutResume = vi.spyOn(child.stdout, 'resume')
    const stderrResume = vi.spyOn(child.stderr, 'resume')
    child.pid = 1234
    child.kill = vi.fn(() => { child.emit('exit', 0, null); return true })
    const client = {
      tool: { ids: vi.fn(async () => ({ data: [OPENCODE_CUSTOM_TOOL_ID, 'read'] })) },
      global: { event: vi.fn(async () => ({ stream: [] })) },
    }
    const engine = new OpenCodeEngine({
      appPath: root,
      resourcesPath: root,
      userDataPath: join(root, 'user-data'),
      isPackaged: false,
      platform: 'win32',
      arch: 'x64',
      workspacePath: root,
      executableOverride: executable,
      spawnProcess: vi.fn(() => child) as never,
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ healthy: true, version: OPENCODE_VERSION }) }) as Response),
      createClient: vi.fn(() => client as never),
      acquirePort: async () => 45678,
    })

    await expect(engine.start()).resolves.toMatchObject({ state: 'ready', version: OPENCODE_VERSION, customToolRegistered: true })
    expect(stdoutResume).toHaveBeenCalled()
    expect(stderrResume).toHaveBeenCalled()
    expect(client.tool.ids).toHaveBeenCalled()

    await engine.stop()
    expect(child.kill).toHaveBeenCalled()
    expect(engine.status()).toMatchObject({ state: 'idle', customToolRegistered: null })
  })

  it('exposes only the official OpenCode operations through the trusted IPC adapter', async () => {
    const engine = {
      status: vi.fn(() => ({ state: 'ready', version: OPENCODE_VERSION, commit: OPENCODE_COMMIT, workspace: null, customToolRegistered: true, detail: null, acpAvailable: true })),
      start: vi.fn(async () => engine.status()),
      restart: vi.fn(async () => engine.status()),
      setWorkspace: vi.fn(async (value: unknown) => value),
      listSessions: vi.fn(async () => []),
      createSession: vi.fn(async (title?: unknown) => ({ title })),
      getMessages: vi.fn(async () => []),
      prompt: vi.fn(async (value: unknown) => value),
      cancel: vi.fn(async () => true),
      listProviders: vi.fn(async () => []),
      listAgents: vi.fn(async () => []),
      listTools: vi.fn(async () => ({ ids: [OPENCODE_CUSTOM_TOOL_ID], customToolRegistered: true })),
      getWorkspaceInfo: vi.fn(async () => ({ directory: null, worktree: null, branch: null, changedFiles: 0 })),
      listMcp: vi.fn(async () => []),
      permissionReply: vi.fn(async () => true),
      configureLocalProvider: vi.fn(async () => engine.status()),
    }
    const handlers = createOpenCodeBridgeHandlers(engine as never)

    expect(Object.keys(handlers).sort()).toEqual([
      'metrora:opencodeCancel',
      'metrora:opencodeConfigureLocal',
      'metrora:opencodeCreateSession',
      'metrora:opencodeGetMcp',
      'metrora:opencodeGetMessages',
      'metrora:opencodeGetWorkspace',
      'metrora:opencodeListAgents',
      'metrora:opencodeListProviders',
      'metrora:opencodeListSessions',
      'metrora:opencodeListTools',
      'metrora:opencodePermissionReply',
      'metrora:opencodePrompt',
      'metrora:opencodeRestart',
      'metrora:opencodeSetWorkspace',
      'metrora:opencodeStart',
      'metrora:opencodeStatus',
    ])
    expect(await handlers['metrora:opencodePrompt']!({ requestId: 'request-1', sessionId: 'session-1', text: 'inspect the repo' })).toEqual({ ok: true, value: { requestId: 'request-1', sessionId: 'session-1', text: 'inspect the repo' } })
    expect(engine.prompt).toHaveBeenCalledWith({ requestId: 'request-1', sessionId: 'session-1', text: 'inspect the repo' })
  })
})
