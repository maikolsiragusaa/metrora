// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { createAdvisorConformanceFixture, createAdvisorStaleConformanceFixture, createAdvisorUnavailableConformanceFixture } from './conformance'
import {
  ADVISOR_TOOL_CONTRACT,
  ADVISOR_TOOL_DEFINITIONS,
  AdvisorToolContractError,
  ADVISOR_TOOL_MODEL_FILTER_MAX_LENGTH,
} from './contract'
import { createAdvisorOverviewSnapshot, createAdvisorToolRegistry } from './tools'
import { LMStudioAdvisorRuntime } from './lmstudio'
import { OllamaAdvisorRuntime, type OllamaTransport } from './ollama'
import type { AdvisorDataSource, AdvisorEvidence, AdvisorScope } from './types'

const TOOL_NAMES = [
  'get_spend_snapshot',
  'get_model_efficiency',
  'get_quota_snapshot',
  'get_overview_snapshot',
  'get_project_drivers',
  'get_session_highlights',
  'get_coverage_report',
  'get_bench_evidence',
] as const

function expectContractError(error: unknown, code: AdvisorToolContractError['code']): void {
  expect(error).toBeInstanceOf(AdvisorToolContractError)
  expect((error as AdvisorToolContractError).code).toBe(code)
}

async function rejectsWithCode(operation: Promise<unknown>, code: AdvisorToolContractError['code']): Promise<void> {
  try {
    await operation
    throw new Error('Expected Advisor contract failure.')
  } catch (error) {
    expectContractError(error, code)
  }
}

function scriptedTransport(toolCalls: unknown[], finalContent = 'The observed pattern is worth a closer look.'): OllamaTransport {
  let index = 0
  let listener: ((event: { requestId: string; text: string }) => void) | null = null
  return {
    probe: async () => ({ available: true, models: ['synthetic-model'], detail: 'synthetic' }),
    cancel: async () => true,
    onDelta: callback => {
      listener = callback
      return () => { listener = null }
    },
    chat: async (requestId, _payload) => {
      if (index++ === 0) return { streamed: false, message: { content: '', tool_calls: toolCalls as Array<{ function?: { name?: string; arguments?: unknown } }> } }
      listener?.({ requestId, text: finalContent })
      return { streamed: true, message: { content: finalContent } }
    },
  }
}

describe('AdvisorToolV1 reusable conformance suite', () => {
  it('publishes the stable eight-tool identity, version, schemas, and JSON-safe contract', () => {
    expect(ADVISOR_TOOL_CONTRACT.contractVersion).toBe('advisor-tool-v1')
    expect(ADVISOR_TOOL_CONTRACT.schemaVersion).toBe(1)
    expect(ADVISOR_TOOL_DEFINITIONS.map(tool => tool.function.name)).toEqual(TOOL_NAMES)
    expect(ADVISOR_TOOL_CONTRACT.scope.immutable).toBe(true)
    expect(JSON.parse(JSON.stringify(ADVISOR_TOOL_CONTRACT))).toEqual(expect.objectContaining({ contractVersion: 'advisor-tool-v1', schemaVersion: 1 }))
    for (const tool of ADVISOR_TOOL_DEFINITIONS) {
      const parameters = tool.function.parameters as Record<string, unknown>
      expect(parameters).toMatchObject({ type: 'object', additionalProperties: false, required: [] })
      expect(JSON.parse(JSON.stringify(tool))).toEqual(tool)
    }
  })

  it('executes every tool with bounded JSON-safe, content-minimal output', async () => {
    const fixture = createAdvisorConformanceFixture()
    const registry = createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview)
    for (const name of TOOL_NAMES) {
      const args = name === 'get_quota_snapshot' ? { provider: 'claude' } : name === 'get_spend_snapshot' || name === 'get_model_efficiency' || name === 'get_overview_snapshot' ? { model: 'gpt-safe' } : {}
      const result = await registry.execute(name, args)
      expect(() => JSON.parse(result.content)).not.toThrow()
      expect(new TextEncoder().encode(result.content).byteLength).toBeLessThanOrEqual(32 * 1024)
      expect(result.envelope).toMatchObject({ contractVersion: 'advisor-tool-v1', tool: name, privacy: 'content-minimal' })
      expect(() => JSON.stringify(result.envelope)).not.toThrow()
    }
  })

  it('succeeds for a valid call and keeps the Metrora invocation scope immutable', async () => {
    const fixture = createAdvisorConformanceFixture()
    const registry = createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview)
    const result = await registry.execute('get_spend_snapshot', { model: 'gpt-safe' })
    expect(result.evidence.scope).toMatchObject({ ...fixture.scope, model: 'gpt-safe' })
    expect(result.envelope?.scope).toMatchObject({ ...fixture.scope, model: 'gpt-safe' })
    expect(Object.isFrozen(registry.scope)).toBe(true)
    expect(Object.isFrozen(result.envelope?.scope)).toBe(true)
    expect(fixture.reads.overviews).toContainEqual({ ...fixture.scope, model: 'gpt-safe' })
  })

  it('narrows relative periods without widening the invocation scope', async () => {
    const fixture = createAdvisorConformanceFixture()
    const registry = createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview)
    const yesterday = new Date()
    yesterday.setHours(0, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    const date = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0')

    const result = await registry.execute('get_spend_snapshot', { period: 'yesterday' })

    expect(result.evidence.scope).toMatchObject({ period: 'today', range: { from: date, to: date } })
    expect(fixture.reads.overviews).toContainEqual({ ...fixture.scope, period: 'today', range: { from: date, to: date } })
    await rejectsWithCode(registry.execute('get_spend_snapshot', { period: 'lifetime' }), 'invalid-scope')

    const rangedScope: AdvisorScope = { ...fixture.scope, period: 'week', range: { from: date, to: date } }
    const rangedRegistry = createAdvisorToolRegistry(fixture.source, rangedScope, null)
    await rejectsWithCode(rangedRegistry.execute('get_spend_snapshot', { period: 'today' }), 'invalid-scope')
  })

  it('fails closed for unknown tools, wrong types, unsupported providers, malformed filters, and additional args', async () => {
    const fixture = createAdvisorConformanceFixture()
    const registry = createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview)
    await rejectsWithCode(registry.execute('unknown_tool', {}), 'unknown-tool')
    await rejectsWithCode(registry.execute('get_spend_snapshot', { model: 42 }), 'invalid-argument-type')
    await rejectsWithCode(registry.execute('get_quota_snapshot', { provider: 'openai' }), 'invalid-argument-value')
    await rejectsWithCode(registry.execute('get_spend_snapshot', { model: '   ' }), 'invalid-argument-value')
    await rejectsWithCode(registry.execute('get_spend_snapshot', { model: 'x'.repeat(ADVISOR_TOOL_MODEL_FILTER_MAX_LENGTH + 1) }), 'invalid-argument-value')
    await rejectsWithCode(registry.execute('get_project_drivers', { model: 'gpt-safe' }), 'additional-argument')
    expect(fixture.reads.overviews).toHaveLength(0)
    expect(fixture.reads.quotas).toBe(0)
  })

  it('keeps unavailable provider authority unavailable and preserves an explicit factual zero', async () => {
    const unavailable = createAdvisorUnavailableConformanceFixture()
    const unavailableResult = await createAdvisorToolRegistry(unavailable.source, unavailable.scope, unavailable.overview).execute('get_quota_snapshot', { provider: 'codex' })
    expect(unavailableResult.envelope).toMatchObject({ unavailable: true, freshness: 'unavailable' })
    expect(unavailableResult.evidence.coverage.level).toBe('unavailable')
    expect(unavailableResult.content).not.toContain('"creditsUSD":0')

    const factual = createAdvisorConformanceFixture()
    const factualResult = await createAdvisorToolRegistry(factual.source, factual.scope, factual.overview).execute('get_quota_snapshot', { provider: 'claude' })
    expect(factualResult.evidence.quota?.providers[0]?.creditsUSD).toBe(0)
    expect(factualResult.content).toContain('"creditsUSD":0')
  })

  it('keeps stale provider evidence labelled stale instead of refreshing or estimating it', async () => {
    const fixture = createAdvisorStaleConformanceFixture()
    const result = await createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview).execute('get_quota_snapshot', { provider: 'codex' })
    expect(result.envelope?.freshness).toBe('stale')
    expect(result.evidence.coverage.level).toBe('partial')
    expect(result.evidence.quota?.providers[0]).toMatchObject({ freshness: 'stale', availability: 'unavailable', creditsUSD: 0 })
    expect(result.content).toContain('"freshness":"stale"')
  })

  it('honors cancellation before a read and after an asynchronous read', async () => {
    const fixture = createAdvisorConformanceFixture()
    const before = new AbortController()
    before.abort()
    await expect(createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview).execute('get_spend_snapshot', {}, before.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.reads.overviews).toHaveLength(0)

    let started = false
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const slowSource: AdvisorDataSource = {
      getOverview: async () => { started = true; await gate; return fixture.overview },
      getModels: async () => [],
      getQuota: async () => [],
    }
    const controller = new AbortController()
    const pending = createAdvisorToolRegistry(slowSource, fixture.scope, null).execute('get_spend_snapshot', {}, controller.signal)
    await vi.waitFor(() => expect(started).toBe(true))
    controller.abort()
    release?.()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not expose raw prompts, responses, source code, secrets, or unrestricted paths', async () => {
    const fixture = createAdvisorConformanceFixture()
    const sensitiveOverview = {
      ...fixture.overview,
      rawPrompt: 'RAW_PROMPT_SHOULD_NOT_LEAK',
      rawResponse: 'RAW_RESPONSE_SHOULD_NOT_LEAK',
      sourceCode: 'RAW_SOURCE_SHOULD_NOT_LEAK',
      secret: 'sk-secret-value-should-not-leak',
      current: {
        ...fixture.overview.current,
        topProjects: [{ name: 'C:\\Users\\fixture\\secret-project', cost: 12, sessions: 2 }],
      },
    } as unknown as typeof fixture.overview
    const sourceFixture = createAdvisorConformanceFixture({ overview: sensitiveOverview })
    const result = await createAdvisorToolRegistry(sourceFixture.source, sourceFixture.scope, sensitiveOverview).execute('get_project_drivers', {})
    for (const value of ['RAW_PROMPT_SHOULD_NOT_LEAK', 'RAW_RESPONSE_SHOULD_NOT_LEAK', 'RAW_SOURCE_SHOULD_NOT_LEAK', 'sk-secret-value-should-not-leak', 'C:\\Users\\fixture\\secret-project']) expect(result.content).not.toContain(value)
    expect(result.content).toContain('[redacted]')
  })

  it('is deterministic for the same fixture and rejects mixed-scope evidence', async () => {
    const fixture = createAdvisorConformanceFixture()
    const registry = createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview)
    const first = await registry.execute('get_spend_snapshot', {})
    const second = await registry.execute('get_spend_snapshot', {})
    expect(second.content).toBe(first.content)
    expect(JSON.stringify(second.envelope)).toBe(JSON.stringify(first.envelope))

    const claude = await registry.execute('get_quota_snapshot', { provider: 'claude' })
    const runtime = new OllamaAdvisorRuntime({ model: 'synthetic-model', transport: scriptedTransport([
      { function: { name: 'get_quota_snapshot', arguments: { provider: 'claude' } } },
      { function: { name: 'get_quota_snapshot', arguments: { provider: 'codex' } } },
    ]) })
    const answer = await runtime.generate({
      question: 'Compare provider quota',
      evidence: { ...claude.evidence, scope: fixture.scope },
      tools: ADVISOR_TOOL_DEFINITIONS,
      toolContract: ADVISOR_TOOL_CONTRACT,
      executeTool: registry.execute,
    })
    expect(answer.coverage).toMatchObject({ level: 'unavailable', label: 'Conflicting evidence scopes' })
    expect(answer.evidence).toEqual([])
  })

  it('prevents malformed runtime calls from reaching evidence reads and runs the Ollama adapter on synthetic fixtures', async () => {
    const fixture = createAdvisorConformanceFixture()
    const registry = createAdvisorToolRegistry(fixture.source, fixture.scope, null)
    const evidence = buildSpendEvidence('synthetic', fixture.scope, fixture.overview)
    const execute = vi.fn(registry.execute)
    const malformedRuntime = new OllamaAdvisorRuntime({ model: 'synthetic-model', transport: scriptedTransport([{ function: { name: 'get_spend_snapshot', arguments: '{"model":' } }]) })
    const malformedAnswer = await malformedRuntime.generate({ question: 'What is my spend?', evidence, tools: ADVISOR_TOOL_DEFINITIONS, toolContract: ADVISOR_TOOL_CONTRACT, executeTool: execute })
    expect(malformedAnswer.conclusion).toContain('Metrora measured')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(fixture.reads.overviews).toHaveLength(1)

    const runtime = new OllamaAdvisorRuntime({ model: 'synthetic-model', transport: scriptedTransport([{ function: { name: 'get_spend_snapshot', arguments: '{}' } }]) })
    const answer = await runtime.generate({ question: 'What is my spend?', evidence, tools: ADVISOR_TOOL_DEFINITIONS, toolContract: ADVISOR_TOOL_CONTRACT, executeTool: registry.execute })
    expect(answer.generatedByModel).toBe(true)
    expect(answer.evidence.length).toBeGreaterThan(0)
    expect(fixture.reads.overviews).toHaveLength(2)
  })

  it('keeps content-minimal evidence safe for no-digit secrets, paths, and internal identifiers', async () => {
    const fixture = createAdvisorConformanceFixture()
    const sensitiveOverview = {
      ...fixture.overview,
      current: {
        ...fixture.overview.current,
        topModels: [{ name: 'token=supersecretvalue', cost: 8, calls: 2 }],
        topProjects: [
          { name: 'project/alpha', cost: 6, sessions: 1 },
          { name: '/home/fixture/private/project', cost: 6, sessions: 1 },
        ],
        topSessions: [{ project: 'raw prompt marker text', cost: 12, calls: 1 }],
      },
    } as unknown as typeof fixture.overview
    const scope = { ...fixture.scope, projectId: 'account-secret', projectName: 'project/alpha' }
    const registry = createAdvisorToolRegistry(fixture.source, scope, createAdvisorOverviewSnapshot(scope, sensitiveOverview))
    const result = await registry.execute('get_spend_snapshot', {})
    const serialized = result.content + JSON.stringify(result.envelope)
    for (const value of ['supersecretvalue', '/home/fixture/private/project', 'raw prompt marker text', 'account-secret']) {
      expect(serialized).not.toContain(value)
    }
    expect(serialized).toContain('project/alpha')
    expect(result.envelope?.scope.projectId).toBe('[scoped-project]')
    expect(result.content).toContain('[redacted]')
  })
  it('runs the same canonical tool loop through the LM Studio runtime adapter', async () => {
    const fixture = createAdvisorConformanceFixture()
    const registry = createAdvisorToolRegistry(fixture.source, fixture.scope, null)
    const evidence = buildSpendEvidence('synthetic', fixture.scope, fixture.overview)
    const runtime = new LMStudioAdvisorRuntime({ model: 'synthetic-lmstudio', transport: scriptedTransport([{ function: { name: 'get_spend_snapshot', arguments: '{}' } }]) })
    const answer = await runtime.generate({
      question: 'What changed?',
      evidence,
      tools: ADVISOR_TOOL_DEFINITIONS,
      toolContract: ADVISOR_TOOL_CONTRACT,
      executeTool: registry.execute,
    })
    expect(answer.runtime).toMatchObject({ id: 'lmstudio-local', mode: 'lmstudio-local' })
    expect(answer.generatedByModel).toBe(true)
    expect(answer.evidence.length).toBeGreaterThan(0)
    expect(fixture.reads.overviews).toHaveLength(1)
  })

})
