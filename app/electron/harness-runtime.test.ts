// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmAdapter, LlmError, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type ResolvedRetryPolicy, type StreamChunk, type ToolCallId } from '@deepseek-ai/dsh-llm'

import { createMetroraHarnessAuthority } from './harness-authority.mjs'
import { MetroraHarnessHost } from './harness-runtime.mjs'
import { MetroraToolBridge, metroraToolDefinitions } from './harness-tool-bridge.mjs'
import type { MetroraHarnessToolRegistry } from './canonical-metrora-tools.mjs'
import { projectHarnessRuntimeEvent, projectHarnessText, type HarnessScopeInput } from './harness-runtime-types'
import { METRORA_TOOL_DEFINITIONS } from '../../src/tools/contract'
import { createMetroraToolRegistry } from '../../src/tools/registry'

const scope: HarnessScopeInput = {
  period: 'today',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

const canonicalToolRegistry: MetroraHarnessToolRegistry = {
  definitions: METRORA_TOOL_DEFINITIONS,
  create: createMetroraToolRegistry as unknown as MetroraHarnessToolRegistry['create'],
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolResponse(calls: Array<{ id: string; name: string; arguments?: string }>): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    const argumentsText = call.arguments ?? '{}'
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: call.id as ToolCallId, name: call.name, argumentsDelta: argumentsText },
      { type: 'block-end', index, block: { type: 'tool-call', id: call.id as ToolCallId, name: call.name, arguments: argumentsText } },
    )
  })
  chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

class ScriptedAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []

  constructor(private readonly script: (options: GenerateOptions, call: number) => StreamChunk[], private readonly contextWindow = 32_768) {
    super()
  }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Harness test adapter' }
  }

  providerRetryPolicy(): ResolvedRetryPolicy {
    return { mode: 'normal', maxRetries: 1, retryableCodes: ['SERVER'], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }
  }

  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return []
  }

  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: this.contextWindow } }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    for (const chunk of this.script(options, this.calls.length)) yield chunk
  }
}

function sourceFixture(overrides: { onOverview?: (scope: HarnessScopeInput) => unknown; onModels?: (scope: HarnessScopeInput) => unknown; onQuota?: () => unknown } = {}) {
  const reads = { overview: 0, models: 0, quota: 0 }
  const overviewScopes: HarnessScopeInput[] = []
  return {
    reads,
    overviewScopes,
    source: {
      async getOverview(scope: HarnessScopeInput) {
        reads.overview += 1
        overviewScopes.push(scope)
        return overrides.onOverview?.(scope) ?? { current: { cost: 12 }, raw_path: 'C:\\private\\prompt.txt' }
      },
      async getModels(scope: HarnessScopeInput) {
        reads.models += 1
        return overrides.onModels?.(scope) ?? [{ model: 'local', costUSD: 2, calls: 1 }]
      },
      async getQuota() {
        reads.quota += 1
        return overrides.onQuota?.() ?? [{ provider: 'claude', remainingPercent: 80 }]
      },
    },
  }
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'metrora-harness-vitest-'))
}

describe('Metrora DSH Harness runtime', () => {
  it('continues through multiple native Metrora read tools and projects only safe messages', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture()
    const adapter = new ScriptedAdapter((_options, call) => call === 1
      ? toolResponse([
          { id: 'overview-1', name: 'get_overview_snapshot' },
          { id: 'models-1', name: 'get_model_efficiency' },
        ])
      : textResponse('Measured spend is available from Metrora canonical evidence.'))
    const host = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: adapter, toolSource: fixture.source })

    try {
      const result = await host.sendMessage({ conversationId: 'multi-tool', runtime: 'ollama', model: 'local', question: 'What changed?', scope })
      const conversation = await host.getConversation('multi-tool')

      expect(result.message.text).toContain('Measured spend')
      expect(fixture.reads).toEqual({ overview: 2, models: 1, quota: 0 })
      expect(adapter.calls).toHaveLength(2)
      expect(conversation?.messages.map(message => message.role)).toEqual(['user', 'assistant'])
      expect(JSON.stringify(conversation)).not.toContain('private')
      expect(JSON.stringify(conversation)).not.toContain('raw_path')
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists the DSH session and resumes it after a cold host restart', async () => {
    const root = await tempRoot()
    const first = sourceFixture()
    const firstAdapter = new ScriptedAdapter((_options, call) => textResponse(`Answer ${call}`))
    const firstHost = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: firstAdapter, toolSource: first.source })

    try {
      await firstHost.sendMessage({ conversationId: 'resume-me', runtime: 'ollama', model: 'local', question: 'first', scope })
      await firstHost.shutdown()

      const second = sourceFixture()
      const secondHost = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: new ScriptedAdapter((_options, call) => textResponse(`Answer ${call + 1}`)), toolSource: second.source })
      try {
        expect((await secondHost.listConversations()).map(item => item.id)).toContain('resume-me')
        expect((await secondHost.getConversation('resume-me'))?.messages.map(message => message.text)).toEqual(['first', 'Answer 1'])
        await secondHost.sendMessage({ conversationId: 'resume-me', runtime: 'ollama', model: 'local', question: 'second', scope })
        expect((await secondHost.getConversation('resume-me'))?.messages.map(message => message.text)).toEqual(['first', 'Answer 1', 'second', 'Answer 2'])
      } finally {
        await secondHost.shutdown()
      }
    } finally {
      await firstHost.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('switches the actual DSH GenerateOptions route/model while preserving one durable Session', async () => {
    const root = await tempRoot()
    const firstFixture = sourceFixture()
    const firstAdapter = new ScriptedAdapter((_options, call) => textResponse(`Answer ${call}`))
    const firstHost = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: firstAdapter, toolSource: firstFixture.source })

    try {
      await firstHost.sendMessage({ conversationId: 'switch-me', runtime: 'ollama', model: 'model-a', question: 'first route', scope, requestId: 'switch-1' })
      await firstHost.sendMessage({ conversationId: 'switch-me', runtime: 'lmstudio', model: 'model-b', question: 'second route', scope, requestId: 'switch-2' })

      expect(firstAdapter.calls.map(call => ({ provider: call.provider, model: call.model }))).toEqual([
        { provider: 'metrora-local-ollama', model: 'model-a' },
        { provider: 'metrora-local-lmstudio', model: 'model-b' },
      ])

      await firstHost.shutdown()
      const secondFixture = sourceFixture()
      const secondAdapter = new ScriptedAdapter((_options, call) => textResponse(`Restarted answer ${call}`))
      const secondHost = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: secondAdapter, toolSource: secondFixture.source })
      try {
        expect((await secondHost.getConversation('switch-me'))?.messages.map(message => message.text)).toEqual([
          'first route', 'Answer 1', 'second route', 'Answer 2',
        ])
        await secondHost.sendMessage({ conversationId: 'switch-me', runtime: 'lmstudio', model: 'model-b', question: 'after restart', scope, requestId: 'switch-3' })
        expect(secondAdapter.calls[0]).toMatchObject({ provider: 'metrora-local-lmstudio', model: 'model-b' })
        expect((await secondHost.getConversation('switch-me'))?.messages.map(message => message.text)).toEqual([
          'first route', 'Answer 1', 'second route', 'Answer 2', 'after restart', 'Restarted answer 1',
        ])
      } finally {
        await secondHost.shutdown()
      }
    } finally {
      await firstHost.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers a transient provider failure through the DSH retry extension', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture()
    const adapter = new ScriptedAdapter((_options, call) => {
      if (call === 1) throw new LlmError('Temporary local provider outage.', 'SERVER', { status: 503 })
      return textResponse('Recovered after a bounded provider retry.')
    })
    const host = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: adapter, toolSource: fixture.source })

    try {
      const result = await host.sendMessage({ conversationId: 'retry-me', runtime: 'ollama', model: 'local', question: 'retry this safely', scope })
      expect(result.message.text).toContain('Recovered after a bounded provider retry')
      expect(adapter.calls).toHaveLength(2)
      expect((await host.getConversation('retry-me'))?.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retries a terminal failed turn after restart without appending a duplicate durable user message', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture()
    const states: string[] = []
    const failedAdapter = new ScriptedAdapter(() => { throw new LlmError('Terminal provider failure.', 'AUTH') })
    const failedHost = new MetroraHarnessHost({
      sessionRoot: root,
      toolRegistry: canonicalToolRegistry,
      llmAdapter: failedAdapter,
      toolSource: fixture.source,
      onEvent: event => states.push(event.state),
    })

    try {
      await expect(failedHost.sendMessage({ conversationId: 'terminal-retry', runtime: 'ollama', model: 'local', question: 'Keep this exact request.', scope, requestId: 'retry-original' })).rejects.toThrow()
      expect(failedAdapter.calls).toHaveLength(1)
      expect(states).toContain('failed')
      expect((await failedHost.getConversation('terminal-retry'))?.messages.map(message => message.text)).toEqual(['Keep this exact request.'])
      await failedHost.shutdown()

      const retryFixture = sourceFixture()
      const retryHost = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: new ScriptedAdapter(() => textResponse('Recovered without duplication.')), toolSource: retryFixture.source })
      try {
        await retryHost.sendMessage({ conversationId: 'terminal-retry', runtime: 'ollama', model: 'local', question: 'Keep this exact request.', requestId: 'retry-again', retryRequestId: 'retry-original', scope })
        expect((await retryHost.getConversation('terminal-retry'))?.messages.map(message => message.text)).toEqual([
          'Keep this exact request.', 'Recovered without duplication.',
        ])
        expect((await retryHost.getConversation('terminal-retry'))?.messages.filter(message => message.role === 'user')).toHaveLength(1)
      } finally {
        await retryHost.shutdown()
      }
    } finally {
      await failedHost.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses DSH compaction before a pressured request while preserving the durable answer projection', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture({ onOverview: () => ({ current: { cost: 12, detail: 'x'.repeat(25_000) } }) })
    const adapter = new ScriptedAdapter((_options, call) => call === 1
      ? toolResponse([{ id: 'large-overview', name: 'get_overview_snapshot' }])
      : textResponse(call === 2 ? 'Compaction checkpoint.' : 'Final answer after compaction.'), 256)
    const host = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: adapter, toolSource: fixture.source })

    try {
      const result = await host.sendMessage({ conversationId: 'compact-me', runtime: 'ollama', model: 'local', question: 'read the selected overview', scope })
      expect(adapter.calls.length).toBeGreaterThanOrEqual(3)
      expect(result.message.text).toContain('Final answer after compaction')
      expect((await host.getConversation('compact-me'))?.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps Shield/ACT as the only mutation authority while allowing bounded read delegation', () => {
    const authority = createMetroraHarnessAuthority()
    expect(authority.decide({ name: 'get_overview_snapshot' })).toEqual({ kind: 'allow' })
    expect(authority.decide({ name: 'subagent' })).toEqual({ kind: 'allow' })
    expect(authority.decide({ name: 'read' }).kind).toBe('deny')
    expect(authority.decide({ name: 'write' }).kind).toBe('deny')
    expect(authority.decide({ name: 'str_replace_editor' }).kind).toBe('deny')
    expect(authority.decide({ name: 'pwsh' }).kind).toBe('deny')
    expect(authority.decide({ name: 'unknown-capability' }).kind).toBe('deny')
  })

  it('keeps native DSH tool registrations aligned with the canonical Metrora contract', () => {
    expect(metroraToolDefinitions(canonicalToolRegistry)).toEqual(METRORA_TOOL_DEFINITIONS)
  })

  it('keeps DSH adapter results semantically identical to direct canonical registry execution', async () => {
    const parityScope: HarnessScopeInput = { ...scope, period: 'month' }
    const fixture = sourceFixture({
      onOverview: () => ({ current: { cost: 12, calls: 3, pricingCoverage: 1 }, raw_path: 'C:\\private\\prompt.txt' }),
      onQuota: () => [{
        provider: 'codex',
        availability: 'available',
        connection: 'connected',
        freshness: 'fresh',
        observedAt: '2026-09-03T10:00:00.000Z',
        windows: [{ id: 'hour', label: 'Hourly', usedFraction: 0.2, resetsAt: '2026-09-03T11:00:00.000Z' }],
      }],
    })
    const bridge = new MetroraToolBridge(fixture.source, canonicalToolRegistry)
    bridge.setScope('parity', parityScope)
    const parityAgent = { id: 'parity' } as Pick<Agent, 'id'>
    const cases = [
      { name: 'get_spend_snapshot', args: {} },
      { name: 'get_quota_snapshot', args: { provider: 'codex' } },
      { name: 'get_model_efficiency', args: {} },
      { name: 'get_overview_snapshot', args: { period: 'week' } },
    ] as const

    for (const invocation of cases) {
      const direct = await canonicalToolRegistry.create(fixture.source, parityScope).execute(invocation.name, invocation.args)
      const adapted = await bridge.executeForAgent(invocation.name, invocation.args, parityAgent)
      expect(adapted).toEqual(direct)
    }

    const quota = await bridge.executeForAgent('get_quota_snapshot', { provider: 'codex' }, parityAgent)
    expect(quota.envelope?.authority).toBe('provider-reported')
    expect(quota.envelope?.semantics[0]).toEqual({ source: 'quota', authority: 'provider-reported', status: 'observed' })
    expect(quota.envelope?.semantics.some(item => item.source === 'quota' && item.authority === 'metrora-canonical')).toBe(false)

    const unavailableFixture = sourceFixture({ onOverview: () => ({}), onModels: () => [], onQuota: () => [] })
    const unavailableBridge = new MetroraToolBridge(unavailableFixture.source, canonicalToolRegistry)
    unavailableBridge.setScope('unavailable', scope)
    const unavailableAgent = { id: 'unavailable' } as Pick<Agent, 'id'>
    const unavailableDirect = await canonicalToolRegistry.create(unavailableFixture.source, scope).execute('get_bench_evidence', {})
    const unavailableAdapted = await unavailableBridge.executeForAgent('get_bench_evidence', {}, unavailableAgent)
    expect(unavailableAdapted).toEqual(unavailableDirect)
    expect(unavailableAdapted.envelope?.unavailable).toBe(true)
    expect(unavailableAdapted.envelope?.semantics).toEqual([{ source: 'unknown', authority: 'unknown', status: 'unknown' }])
    expect(unavailableAdapted.content).not.toContain('private')
    expect(unavailableAdapted.content).not.toContain('raw_path')
  })

  it('fails closed when an Agent has no explicit scope association', async () => {
    const fixture = sourceFixture()
    const bridge = new MetroraToolBridge(fixture.source, canonicalToolRegistry)
    const agent = { id: 'scope-missing' } as Pick<Agent, 'id'>
    expect(() => bridge.scopeForAgent(agent)).toThrow('scope is not bound')
    expect(() => bridge.executeForAgent('get_overview_snapshot', {}, agent)).toThrow('scope is not bound')
    expect(fixture.reads.overview).toBe(0)
  })

  it('isolates simultaneous conversation scopes and never uses another conversation as a fallback', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture()
    const adapter = new ScriptedAdapter(options => {
      const hasToolCall = options.messages.some(message => message.role === 'assistant' && message.content.some(block => block.type === 'tool-call'))
      return hasToolCall ? textResponse('Scoped result.') : toolResponse([{ id: 'scope-read', name: 'get_overview_snapshot' }])
    })
    const host = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: adapter, toolSource: fixture.source })
    const scopeA: HarnessScopeInput = { ...scope, period: 'week', projectId: 'project-a', projectName: 'Project A', model: 'model-a' }
    const scopeB: HarnessScopeInput = { ...scope, period: '30days', projectId: 'project-b', projectName: 'Project B', model: 'model-b' }

    try {
      await Promise.all([
        host.sendMessage({ conversationId: 'scope-a', runtime: 'ollama', model: 'model-a', question: 'Read A', scope: scopeA }),
        host.sendMessage({ conversationId: 'scope-b', runtime: 'lmstudio', model: 'model-b', question: 'Read B', scope: scopeB }),
      ])
      expect(fixture.overviewScopes).toHaveLength(2)
      expect(fixture.overviewScopes.map(item => ({ period: item.period, projectId: item.projectId, model: item.model }))).toEqual(expect.arrayContaining([
        { period: 'week', projectId: 'project-a', model: 'model-a' },
        { period: '30days', projectId: 'project-b', model: 'model-b' },
      ]))
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the DSH subagent substrate with a bounded read-only child route', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture()
    const parentScope: HarnessScopeInput = { ...scope, period: 'week', projectId: 'parent-project', projectName: 'Parent project', model: 'parent-model' }
    const adapter = new ScriptedAdapter((_options, call) => {
      if (call === 1) return toolResponse([{ id: 'delegate-1', name: 'subagent', arguments: JSON.stringify({ prompt: 'Read the selected Metrora facts.', run_in_background: false }) }])
      if (call === 2) return toolResponse([{ id: 'child-overview', name: 'get_overview_snapshot' }])
      return textResponse('Bounded child read complete.')
    })
    const host = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: adapter, toolSource: fixture.source })

    try {
      const result = await host.sendMessage({ conversationId: 'delegate-me', runtime: 'ollama', model: 'parent-model', question: 'Use a bounded read delegate.', scope: parentScope })
      expect(result.message.text).toContain('Bounded child read complete')
      expect(adapter.calls).toHaveLength(3)
      expect(fixture.overviewScopes).toEqual([expect.objectContaining({ period: 'week', projectId: 'parent-project', projectName: 'Parent project', model: 'parent-model' })])
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cancels an active DSH turn and emits a product-safe cancellation state', async () => {
    const root = await tempRoot()
    let started = false
    const adapter = new ScriptedAdapter(options => {
      started = true
      return []
    })
    adapter.stream = async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
      adapter.calls.push(options)
      await new Promise(resolve => options.signal?.addEventListener('abort', resolve, { once: true }))
      throw Object.assign(new Error('request aborted'), { name: 'AbortError' })
    }
    const states: string[] = []
    const fixture = sourceFixture()
    const host = new MetroraHarnessHost({ sessionRoot: root, toolRegistry: canonicalToolRegistry, llmAdapter: adapter, toolSource: fixture.source, onEvent: event => states.push(event.state) })

    try {
      const pending = host.sendMessage({ conversationId: 'cancel-me', runtime: 'ollama', model: 'local', question: 'wait', scope })
      for (let attempt = 0; attempt < 20 && !started; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
      expect(await host.cancelConversation('cancel-me')).toBe(true)
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(states).toContain('cancelled')
      expect(states).not.toContain('failed')
    } finally {
      await host.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps renderer-facing projections content-minimal and bounded', () => {
    const text = projectHarnessText('api-key: super-secret bearer abc C:\\Users\\sirag\\private.txt raw prompt source code')
    expect(text).not.toContain('super-secret')
    expect(text).not.toContain('abc')
    expect(text).not.toContain('C:\\Users')
    expect(text).toContain('[redacted]')
    expect(projectHarnessText('x'.repeat(40_000))).toHaveLength(32_000)
    expect(projectHarnessRuntimeEvent({ conversationId: 'conversation/unsafe', state: 'done', requestId: 'req unsafe' })).toEqual({ conversationId: 'conversationunsafe', state: 'done', requestId: 'requnsafe' })
  })
})
