// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { LlmAdapter, LlmError, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type ResolvedRetryPolicy, type StreamChunk, type ToolCallId } from '@deepseek-ai/dsh-llm'

import { createMetroraHarnessAuthority } from './harness-authority.mjs'
import { MetroraHarnessHost } from './harness-runtime.mjs'
import { metroraToolDefinitions } from './harness-tool-bridge.mjs'
import { projectHarnessRuntimeEvent, projectHarnessText, type HarnessScopeInput } from './harness-runtime-types'
import { METRORA_TOOL_DEFINITIONS } from '../../src/tools/contract'

const scope: HarnessScopeInput = {
  period: 'today',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
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

function sourceFixture(overrides: { onOverview?: () => unknown; onModels?: () => unknown; onQuota?: () => unknown } = {}) {
  const reads = { overview: 0, models: 0, quota: 0 }
  return {
    reads,
    source: {
      async getOverview() {
        reads.overview += 1
        return overrides.onOverview?.() ?? { current: { cost: 12 }, raw_path: 'C:\\private\\prompt.txt' }
      },
      async getModels() {
        reads.models += 1
        return overrides.onModels?.() ?? [{ model: 'local', costUSD: 2, calls: 1 }]
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
    const host = new MetroraHarnessHost({ sessionRoot: root, workspaceRoot: process.cwd(), llmAdapter: adapter, toolSource: fixture.source })

    try {
      const result = await host.sendMessage({ conversationId: 'multi-tool', runtime: 'ollama', model: 'local', question: 'What changed?', scope })
      const conversation = await host.getConversation('multi-tool')

      expect(result.message.text).toContain('Measured spend')
      expect(fixture.reads).toEqual({ overview: 1, models: 1, quota: 0 })
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
    const firstHost = new MetroraHarnessHost({ sessionRoot: root, workspaceRoot: process.cwd(), llmAdapter: firstAdapter, toolSource: first.source })

    try {
      await firstHost.sendMessage({ conversationId: 'resume-me', runtime: 'ollama', model: 'local', question: 'first', scope })
      await firstHost.shutdown()

      const second = sourceFixture()
      const secondHost = new MetroraHarnessHost({ sessionRoot: root, workspaceRoot: process.cwd(), llmAdapter: new ScriptedAdapter((_options, call) => textResponse(`Answer ${call + 1}`)), toolSource: second.source })
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

  it('recovers a transient provider failure through the DSH retry extension', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture()
    const adapter = new ScriptedAdapter((_options, call) => {
      if (call === 1) throw new LlmError('Temporary local provider outage.', 'SERVER', { status: 503 })
      return textResponse('Recovered after a bounded provider retry.')
    })
    const host = new MetroraHarnessHost({ sessionRoot: root, workspaceRoot: process.cwd(), llmAdapter: adapter, toolSource: fixture.source })

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

  it('uses DSH compaction before a pressured request while preserving the durable answer projection', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture({ onOverview: () => ({ current: { cost: 12, detail: 'x'.repeat(25_000) } }) })
    const adapter = new ScriptedAdapter((_options, call) => call === 1
      ? toolResponse([{ id: 'large-overview', name: 'get_overview_snapshot' }])
      : textResponse(call === 2 ? 'Compaction checkpoint.' : 'Final answer after compaction.'), 256)
    const host = new MetroraHarnessHost({ sessionRoot: root, workspaceRoot: process.cwd(), llmAdapter: adapter, toolSource: fixture.source })

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
    expect(authority.decide({ name: 'read' })).toEqual({ kind: 'allow' })
    expect(authority.decide({ name: 'subagent' })).toEqual({ kind: 'allow' })
    expect(authority.decide({ name: 'write' }).kind).toBe('deny')
    expect(authority.decide({ name: 'str_replace_editor' }).kind).toBe('deny')
    expect(authority.decide({ name: 'pwsh' }).kind).toBe('deny')
    expect(authority.decide({ name: 'unknown-capability' }).kind).toBe('deny')
  })

  it('keeps native DSH tool registrations aligned with the canonical Metrora contract', () => {
    expect(metroraToolDefinitions()).toEqual(METRORA_TOOL_DEFINITIONS.map(definition => ({
      name: definition.function.name,
      description: definition.function.description,
      parameters: definition.function.parameters,
    })))
  })

  it('uses the DSH subagent substrate with a bounded read-only child route', async () => {
    const root = await tempRoot()
    const fixture = sourceFixture()
    const adapter = new ScriptedAdapter((_options, call) => call === 1
      ? toolResponse([{ id: 'delegate-1', name: 'subagent', arguments: JSON.stringify({ prompt: 'Read the selected Metrora facts.', run_in_background: false }) }])
      : textResponse('Bounded child read complete.'))
    const host = new MetroraHarnessHost({ sessionRoot: root, workspaceRoot: process.cwd(), llmAdapter: adapter, toolSource: fixture.source })

    try {
      const result = await host.sendMessage({ conversationId: 'delegate-me', runtime: 'ollama', model: 'local', question: 'Use a bounded read delegate.', scope })
      expect(result.message.text).toContain('Bounded child read complete')
      expect(adapter.calls).toHaveLength(2)
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
    const host = new MetroraHarnessHost({ sessionRoot: root, workspaceRoot: process.cwd(), llmAdapter: adapter, toolSource: fixture.source, onEvent: event => states.push(event.state) })

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
