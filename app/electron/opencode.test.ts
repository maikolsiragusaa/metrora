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
import { listProviderAuth, permissionReply as sendPermissionReply, prompt as sendPrompt, providerOAuthAuthorize, providerOAuthCallback, questionReject, questionReply, setProviderApiKey } from './opencode/client'
import { localProviderConfig } from './opencode/config'
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
      type: 'message.part.delta',
      properties: {
        sessionID: 'session-1',
        messageID: 'message-1',
        partID: 'part-1',
        field: 'text',
        delta: 'safe answer token=secret',
      },
    })
    expect(delta).toEqual({
      kind: 'message-delta',
      sessionId: 'session-1',
      messageId: 'message-1',
      partId: 'part-1',
      field: 'text',
      text: 'safe answer [redacted]',
    })

    const complete = projectOpenCodeEventForRenderer({
      type: 'message.part.updated',
      properties: {
        sessionID: 'session-1',
        part: { id: 'part-1', messageID: 'message-1', type: 'text', text: 'safe answer token=secret' },
      },
    })
    expect(complete).toEqual({ kind: 'message-part-updated', sessionId: 'session-1', messageId: 'message-1', partId: 'part-1', field: 'text', text: 'safe answer [redacted]' })

    const message = projectOpenCodeEventForRenderer({
      type: 'message.updated',
      properties: {
        info: { id: 'message-2', sessionID: 'session-2', role: 'assistant', time: { completed: 123 } },
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

    expect(projectOpenCodeEventForRenderer({
      type: 'message.part.updated',
      properties: { sessionID: 'session-1', part: { id: 'part-3', messageID: 'message-1', type: 'tool', tool: 'bash', state: { status: 'running', title: 'Running command' } } },
    })).toEqual({ kind: 'tool', sessionId: 'session-1', messageId: 'message-1', partId: 'part-3', tool: 'bash', status: 'running', title: 'Running command' })
  })

  it('projects the exact permission lifecycle and never accepts the removed permission.updated event', () => {
    const asked = projectOpenCodeEventForRenderer({
      type: 'permission.asked',
      properties: {
        id: 'permission-1', sessionID: 'session-1', permission: 'edit', patterns: ['src/**'], always: ['src/**'],
        metadata: { path: 'C:\\Users\\founder\\repo', reason: 'safe' }, tool: { messageID: 'message-1', callID: 'call-1' },
      },
    })
    expect(asked).toEqual({ kind: 'permission', sessionId: 'session-1', permissionId: 'permission-1', permission: 'edit', patterns: ['src/**'], always: ['src/**'], metadata: { path: '[redacted]', reason: 'safe' }, tool: { messageId: 'message-1', callId: 'call-1' } })
    expect(projectOpenCodeEventForRenderer({ type: 'permission.updated', properties: { id: 'legacy' } })).toBeNull()
    for (const reply of ['once', 'always', 'reject'] as const) {
      expect(projectOpenCodeEventForRenderer({ type: 'permission.replied', properties: { sessionID: 'session-1', requestID: 'permission-1', reply } })).toEqual({ kind: 'permission-replied', sessionId: 'session-1', requestId: 'permission-1', reply })
    }
  })

  it('projects structured OpenCode questions, answers, rejection, and incremental deltas', () => {
    expect(projectOpenCodeEventForRenderer({
      type: 'question.asked',
      properties: { id: 'question-1', sessionID: 'session-1', questions: [{ header: 'Mode', question: 'Which mode?', options: [{ label: 'Plan', description: 'Read-only' }, { label: 'Build', description: 'Edit files' }], multiple: false, custom: true }] },
    })).toEqual({ kind: 'question-asked', sessionId: 'session-1', requestId: 'question-1', questions: [{ header: 'Mode', question: 'Which mode?', options: [{ label: 'Plan', description: 'Read-only' }, { label: 'Build', description: 'Edit files' }], multiple: false, custom: true }], tool: null })
    expect(projectOpenCodeEventForRenderer({ type: 'question.replied', properties: { sessionID: 'session-1', requestID: 'question-1', answers: [['Plan']] } })).toEqual({ kind: 'question-replied', sessionId: 'session-1', requestId: 'question-1' })
    expect(projectOpenCodeEventForRenderer({ type: 'question.rejected', properties: { sessionID: 'session-1', requestID: 'question-1' } })).toEqual({ kind: 'question-rejected', sessionId: 'session-1', requestId: 'question-1' })
    const deltas = ['Open', 'Code', ' is ready'].map(delta => projectOpenCodeEventForRenderer({ type: 'message.part.delta', properties: { sessionID: 'session-1', messageID: 'message-1', partID: 'part-1', field: 'text', delta } }))
    expect(deltas.map(item => item && item.kind === 'message-delta' ? item.text : '')).toEqual(['Open', 'Code', ' is ready'])
  })
})

describe('OpenCode official SDK calls', () => {
  const call = async <T>(operation: () => Promise<{ data?: T; error?: unknown }>): Promise<T> => {
    const result = await operation()
    if (result.data === undefined) throw new Error('missing data')
    return result.data
  }

  it('routes model A/B and the exact variant id through SessionPrompt without introducing a catalog', async () => {
    const prompt = vi.fn(async () => ({ data: { info: { id: 'assistant-1', role: 'assistant', time: { created: 1 }, providerID: 'provider-a', modelID: 'model-b', variant: 'exact-provider-variant' }, parts: [] } }))
    const client = { session: { prompt } } as never
    await sendPrompt(client, 'C:\\workspace', 'session-1', { text: 'continue', model: { providerID: 'provider-b', modelID: 'model-b' }, agent: 'build', variant: 'exact-provider-variant' }, new AbortController().signal, 'C:\\workspace', call)
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'session-1', model: { providerID: 'provider-b', modelID: 'model-b' }, agent: 'build', variant: 'exact-provider-variant' }), expect.objectContaining({ throwOnError: true }))
  })

  it('uses official permission, question, and provider-auth endpoints', async () => {
    const client = {
      permission: { reply: vi.fn(async () => ({ data: true })) },
      question: { reply: vi.fn(async () => ({ data: true })), reject: vi.fn(async () => ({ data: true })) },
      provider: {
        auth: vi.fn(async () => ({ data: { 'opencode-zen': [{ type: 'oauth', label: 'OpenCode Zen', prompts: [] }] } })),
        oauth: {
          authorize: vi.fn(async () => ({ data: { url: 'https://auth.example.test', method: 'code', instructions: 'Enter the code.' } })),
          callback: vi.fn(async () => ({ data: true })),
        },
      },
      auth: { set: vi.fn(async () => ({ data: true })) },
    }
    expect(await sendPermissionReply(client as never, 'C:\\workspace', 'permission-1', 'always', call)).toBe(true)
    expect(await questionReply(client as never, 'C:\\workspace', 'question-1', [['Plan']], call)).toBe(true)
    expect(await questionReject(client as never, 'C:\\workspace', 'question-1', call)).toBe(true)
    expect(await listProviderAuth(client as never, 'C:\\workspace', call)).toEqual({ 'opencode-zen': [{ type: 'oauth', label: 'OpenCode Zen', prompts: [] }] })
    expect(await setProviderApiKey(client as never, 'opencode-zen', 'secret-key', call)).toBe(true)
    expect(await providerOAuthAuthorize(client as never, 'C:\\workspace', 'opencode-zen', 0, { account: 'founder' }, call)).toEqual({ url: 'https://auth.example.test', method: 'code', instructions: 'Enter the code.' })
    expect(await providerOAuthCallback(client as never, 'C:\\workspace', 'opencode-zen', 0, 'oauth-code', call)).toBe(true)
    expect(client.permission.reply).toHaveBeenCalledWith({ directory: 'C:\\workspace', requestID: 'permission-1', reply: 'always' }, { throwOnError: true })
    expect(client.question.reply).toHaveBeenCalledWith({ directory: 'C:\\workspace', requestID: 'question-1', answers: [['Plan']] }, { throwOnError: true })
    expect(client.question.reject).toHaveBeenCalledWith({ directory: 'C:\\workspace', requestID: 'question-1' }, { throwOnError: true })
    expect(client.auth.set).toHaveBeenCalledWith({ providerID: 'opencode-zen', auth: { type: 'api', key: 'secret-key' } }, { throwOnError: true })
    expect(client.provider.oauth.authorize).toHaveBeenCalledWith({ directory: 'C:\\workspace', providerID: 'opencode-zen', method: 0, inputs: { account: 'founder' } }, { throwOnError: true })
    expect(client.provider.oauth.callback).toHaveBeenCalledWith({ directory: 'C:\\workspace', providerID: 'opencode-zen', method: 0, code: 'oauth-code' }, { throwOnError: true })
  })

  it('keeps local provider config free of guessed context/output limits', () => {
    const config = localProviderConfig({ port: 8080, modelId: 'local-model' })
    expect(config).toEqual({ 'llama.cpp': { npm: '@ai-sdk/openai-compatible', name: 'llama-server (local)', options: { baseURL: 'http://127.0.0.1:8080/v1' }, models: { 'local-model': { name: 'local-model (local)' } } } })
    expect(JSON.stringify(config)).not.toContain('128000')
    expect(JSON.stringify(config)).not.toContain('65536')
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
      listProviderAuth: vi.fn(async () => ({})),
      setProviderApiKey: vi.fn(async () => true),
      providerOAuthAuthorize: vi.fn(async () => ({ url: 'https://example.test/auth', method: 'code', instructions: 'Enter the code.' })),
      providerOAuthCallback: vi.fn(async () => true),
      questionReply: vi.fn(async () => true),
      questionReject: vi.fn(async () => true),
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
      'metrora:opencodeListProviderAuth',
      'metrora:opencodeListProviders',
      'metrora:opencodeListSessions',
      'metrora:opencodeListTools',
      'metrora:opencodePermissionReply',
      'metrora:opencodePrompt',
      'metrora:opencodeProviderOAuthAuthorize',
      'metrora:opencodeProviderOAuthCallback',
      'metrora:opencodeQuestionReject',
      'metrora:opencodeQuestionReply',
      'metrora:opencodeRestart',
      'metrora:opencodeSetProviderApiKey',
      'metrora:opencodeSetWorkspace',
      'metrora:opencodeStart',
      'metrora:opencodeStatus',
    ])
    expect(await handlers['metrora:opencodePrompt']!({ requestId: 'request-1', sessionId: 'session-1', text: 'inspect the repo' })).toEqual({ ok: true, value: { requestId: 'request-1', sessionId: 'session-1', text: 'inspect the repo' } })
    expect(engine.prompt).toHaveBeenCalledWith({ requestId: 'request-1', sessionId: 'session-1', text: 'inspect the repo' })
  })
})
