import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type ResolvedRetryPolicy, type StreamChunk, type ToolCallId } from '@deepseek-ai/dsh-llm'

import { createMetroraHarnessAuthority } from './harness-authority.mjs'
import { MetroraHarnessHost } from './harness-runtime.mjs'
import { projectMcpStatusDetail, resolveDshMcpConfig, validateHarnessMcpServers } from './harness-mcp.mjs'
import type { MetroraHarnessToolRegistry } from './canonical-metrora-tools.mjs'
import { METRORA_TOOL_DEFINITIONS } from '../../src/tools/contract'
import { createMetroraToolRegistry } from '../../src/tools/registry'
import type { HarnessScopeInput } from './harness-runtime-types'

const scope: HarnessScopeInput = { period: 'today', range: null, provider: 'all', projectId: 'all', projectName: 'All projects', model: null }
const registry: MetroraHarnessToolRegistry = { definitions: METRORA_TOOL_DEFINITIONS, create: createMetroraToolRegistry as unknown as MetroraHarnessToolRegistry['create'] }
const fixturePath = fileURLToPath(new URL('./test-fixtures/mcp-echo-server.mjs', import.meta.url))

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolResponse(id: string, name: string, args: Record<string, unknown>): StreamChunk[] {
  const argumentsText = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: id as ToolCallId, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: id as ToolCallId, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []
  constructor(private readonly answer: string) { super() }
  providerInfo(provider: string): LlmProviderInfo { return { id: provider, name: 'MCP product fixture adapter' } }
  providerRetryPolicy(): ResolvedRetryPolicy { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }
  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> { return [] }
  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 32_768 } } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    const hasToolResult = options.messages.some(message => message.content.some(block => block.type === 'tool-result'))
    yield* hasToolResult ? textResponse(this.answer) : toolResponse('provider-native-mcp-1', 'mcp__fixture__echo', { value: 'hello' })
  }
}

function mcpConfig(): { id: string; serverName: string; enabled: true; transport: 'stdio'; command: string; args: string[]; cwd: string; env: Record<string, string>; envRefs: Record<string, string> } {
  return { id: 'fixture', serverName: 'fixture', enabled: true, transport: 'stdio', command: process.execPath, args: [fixturePath], cwd: path.dirname(fixturePath), env: {}, envRefs: {} }
}

async function tempRoot(): Promise<string> { return mkdtemp(path.join(os.tmpdir(), 'metrora-mcp-vitest-')) }

describe('Metrora MCP composition', () => {
  it('validates a bounded config and resolves protected values only in main-process DSH config', async () => {
    const config = validateHarnessMcpServers([{ ...mcpConfig(), envRefs: { TOKEN: 'mcp:fixture:TOKEN' } }])
    expect(config[0]).toMatchObject({ serverName: 'fixture', transport: 'stdio' })
    await expect(resolveDshMcpConfig(config[0]!, async reference => reference === 'mcp:fixture:TOKEN' ? 'secret-not-in-profile' : null, process.cwd())).resolves.toMatchObject({ env: { TOKEN: 'secret-not-in-profile' } })
    await expect(resolveDshMcpConfig(config[0]!, async () => null, process.cwd())).rejects.toThrow('Protected MCP environment reference')
    expect(() => validateHarnessMcpServers([{ ...mcpConfig(), cwd: 'relative/path' }])).toThrow('absolute')
    expect(() => validateHarnessMcpServers([{ ...mcpConfig(), env: { API_TOKEN: 'secret' } }])).toThrow('protected credential reference')
    expect(() => validateHarnessMcpServers([{ ...mcpConfig(), transport: 'streamable-http', url: 'file:///tmp/mcp', headers: {}, headerRefs: {} }])).toThrow('http or https')
    expect(projectMcpStatusDetail('spawn C:\\Users\\sirag\\secret-server.exe failed: token=super-secret')).toBe('spawn [redacted path] failed: [redacted secret]')
  })

  it('mounts the real stdio client in the product DSH Agent, gates the call through Shield, and resumes naturally', async () => {
    const root = await tempRoot()
    const marker = path.join(root, 'mcp-calls.log')
    const config = { ...mcpConfig(), args: [fixturePath, marker] }
    const adapter = new ScriptedAdapter('The MCP Tool returned hello and the Agent synthesized this answer.')
    const approvals: Array<{ toolName: string; risk: string }> = []
    const events: any[] = []
    const host = new MetroraHarnessHost({
      sessionRoot: path.join(root, 'sessions'),
      toolRegistry: registry,
      llmAdapter: adapter,
      toolSource: { getOverview: async () => ({}), getModels: async () => [], getQuota: async () => [] },
      mcpServers: [config],
      onApproval: async approval => { approvals.push({ toolName: approval.toolName, risk: approval.risk }); return 'allowed-once' },
      onEvent: event => events.push(event),
    })

    try {
      await expect(host.getMcpStatuses()).resolves.toEqual([expect.objectContaining({ serverName: 'fixture', state: 'connected', toolCount: 1, toolNames: ['mcp__fixture__echo'] })])
      const result = await host.sendMessage({ conversationId: 'mcp-session', runtime: 'ollama', model: 'fixture-model', mode: 'build', workspaceRoot: root, question: 'Use the configured MCP echo Tool.', scope })
      expect(result.message.text).toContain('synthesized this answer')
      expect(approvals).toEqual([{ toolName: 'mcp__fixture__echo', risk: 'external' }])
      expect(adapter.calls).toHaveLength(2)
      expect(adapter.calls[1]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
      expect(events.some(event => event.process?.kind === 'tool' && event.process.item.name === 'mcp__fixture__echo' && event.process.item.source?.serverName === 'fixture')).toBe(true)
      expect(events.some(event => event.process?.kind === 'approval' && event.process.item.risk === 'external')).toBe(true)
      expect(await readFile(marker, 'utf8')).toBe('hello\n')
      const conversation = await host.getConversation('mcp-session')
      expect(JSON.stringify(conversation)).toContain('mcp__fixture__echo')
      expect(JSON.stringify(conversation)).not.toContain(path.resolve(root))
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('denies an external MCP Tool before the child process executes it', async () => {
    const root = await tempRoot()
    const marker = path.join(root, 'denied-mcp-calls.log')
    const adapter = new ScriptedAdapter('The Agent reported that the external action was denied.')
    const events: any[] = []
    const host = new MetroraHarnessHost({
      sessionRoot: path.join(root, 'sessions'),
      toolRegistry: registry,
      llmAdapter: adapter,
      toolSource: { getOverview: async () => ({}), getModels: async () => [], getQuota: async () => [] },
      mcpServers: [{ ...mcpConfig(), args: [fixturePath, marker] }],
      onApproval: async () => 'rejected',
      onEvent: event => events.push(event),
    })
    try {
      const result = await host.sendMessage({ conversationId: 'mcp-denied', runtime: 'ollama', model: 'fixture-model', mode: 'build', workspaceRoot: root, question: 'Try the external MCP Tool.', scope })
      expect(result.message.text).toContain('external action was denied')
      await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(events.some(event => event.process?.kind === 'approval' && event.process.item.state === 'denied')).toBe(true)
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports a failed MCP connection truthfully and clears the client on Host shutdown', async () => {
    const root = await tempRoot()
    const host = new MetroraHarnessHost({
      sessionRoot: path.join(root, 'sessions'),
      toolRegistry: registry,
      llmAdapter: new ScriptedAdapter('MCP is unavailable.'),
      toolSource: { getOverview: async () => ({}), getModels: async () => [], getQuota: async () => [] },
      mcpServers: [{ ...mcpConfig(), id: 'broken', serverName: 'broken', args: ['-e', 'process.exit(1)'] }],
    })
    try {
      const statuses = await host.getMcpStatuses()
      expect(statuses).toEqual([expect.objectContaining({ serverName: 'broken', state: 'failed', toolCount: 0 })])
      expect(statuses[0]?.detail).not.toContain(path.resolve(root))
      await host.shutdown()
      await expect(host.getMcpStatuses()).resolves.toEqual([])
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps MCP identity distinct from local coding policy', () => {
    const authority = createMetroraHarnessAuthority()
    expect(authority.classify('mcp__fixture__echo', { value: 'hello' })).toBe('external')
    expect(authority.decide({ name: 'mcp__fixture__echo', arguments: {} }, { mode: 'ask', workspaceRoot: null })).toEqual({ kind: 'ask', reason: 'External MCP Tools always require explicit Metrora Shield approval.' })
  })
})
