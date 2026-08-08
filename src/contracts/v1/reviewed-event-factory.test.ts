import { describe, expect, it } from 'vitest'

import { calculateCost } from '../../models.js'
import type { ParsedApiCall } from '../../types.js'
import { createReviewedUsageMeasurementEventV1 } from './reviewed-event-factory.js'

const EVENT_KEY = new Uint8Array(32).fill(7)
const SOURCE_SHA = 'a'.repeat(64)

function codexCall(overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  const usage = {
    inputTokens: 60,
    outputTokens: 20,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 40,
    cachedInputTokens: 40,
    reasoningTokens: 5,
    webSearchRequests: 0,
  }
  const model = 'gpt-5.5'
  return {
    provider: 'codex',
    model,
    reasoningLevel: 'high',
    reasoningLevelSource: 'explicit',
    usage,
    costUSD: calculateCost(
      model,
      usage.inputTokens,
      usage.outputTokens + usage.reasoningTokens,
      usage.cacheCreationInputTokens,
      usage.cacheReadInputTokens,
      usage.webSearchRequests,
    ),
    tools: ['Read'],
    mcpTools: ['mcp__private__lookup'],
    skills: ['private-skill'],
    subagentTypes: ['reviewer'],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: '2026-07-31T14:30:00.000Z',
    bashCommands: ['cat /private/secret.txt'],
    deduplicationKey: 'private-message-id',
    toolSequence: [[{ tool: 'Read', file: '/private/secret.txt' }]],
    ...overrides,
  }
}

function geminiCall(overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  const usage = {
    inputTokens: 100,
    outputTokens: 30,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 20,
    cachedInputTokens: 20,
    reasoningTokens: 5,
    webSearchRequests: 0,
  }
  const model = 'gemini-2.5-flash'
  return {
    provider: 'gemini',
    model,
    usage,
    costUSD: calculateCost(
      model,
      usage.inputTokens,
      usage.outputTokens + usage.reasoningTokens,
      usage.cacheCreationInputTokens,
      usage.cacheReadInputTokens,
      usage.webSearchRequests,
    ),
    tools: ['Read'],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: '2026-07-31T14:31:00.000Z',
    bashCommands: [],
    deduplicationKey: 'gemini-private-message-id',
    ...overrides,
  }
}

function context() {
  return {
    workspaceId: 'workspace_01',
    endpointId: 'endpoint_01',
    eventIdentityKey: EVENT_KEY,
    repositoryId: 'repository_01',
    projectId: 'project_01',
    accountId: 'account_01',
    session: { mode: 'include' as const, sessionId: 'session_01' },
    tool: { name: 'Codex', version: '1.0.0' },
    collector: {
      adapterVersion: '0.9.19',
      sourceFingerprintSha256: SOURCE_SHA,
    },
    genAi: {
      operationName: 'invoke_agent' as const,
      providerName: 'openai',
      requestModel: 'gpt-5.5',
    },
  }
}

describe('reviewed usage measurement event factory v1', () => {
  it('creates a public event with profile-owned collector identity', () => {
    const result = createReviewedUsageMeasurementEventV1(codexCall(), context())
    expect(result.status).toBe('created')
    if (result.status !== 'created') return

    expect(result.profileId).toBe('codex-rollout-token-count-v1')
    expect(result.event.data.collector).toEqual({
      adapterId: 'codex-rollout-token-count-v1',
      adapterVersion: '0.9.19',
      sourceKind: 'codex-rollout-jsonl-token-count',
      sourceFingerprintSha256: SOURCE_SHA,
    })
    expect(result.event.data.genAi).toEqual({
      operationName: 'invoke_agent',
      providerName: 'openai',
      requestModel: 'gpt-5.5',
      responseModel: 'gpt-5.5',
    })
    expect(result.event.data.sessionId).toBe('session_01')
    expect(result.event.data.quality).toEqual({
      tokenCounts: 'measured',
      modelIdentity: 'normalized',
      sessionIdentity: 'exact',
    })
    expect(result.event.data.cost).toMatchObject({ kind: 'estimated', method: 'token-pricing' })
  })

  it('creates a reviewed Gemini event without inventing reasoning effort', () => {
    const result = createReviewedUsageMeasurementEventV1(geminiCall(), {
      ...context(),
      session: { mode: 'include', sessionId: 'gemini-session-01' },
      tool: { name: 'Gemini CLI', version: '1.0.0' },
      genAi: {
        operationName: 'invoke_agent',
        providerName: 'google',
        requestModel: 'gemini-2.5-flash',
      },
    })
    expect(result.status).toBe('created')
    if (result.status !== 'created') return

    expect(result.profileId).toBe('gemini-message-usage-v1')
    expect(result.event.data.collector).toMatchObject({
      adapterId: 'gemini-message-usage-v1',
      sourceKind: 'gemini-session-json-or-jsonl-message-usage',
    })
    expect(result.event.data.genAi).toEqual({
      operationName: 'invoke_agent',
      providerName: 'google',
      requestModel: 'gemini-2.5-flash',
      responseModel: 'gemini-2.5-flash',
    })
    expect(result.event.data.quality).toEqual({
      tokenCounts: 'derived',
      modelIdentity: 'exact',
      sessionIdentity: 'exact',
    })
    expect(result.event.data.cost).toMatchObject({ kind: 'estimated', method: 'token-pricing' })
    expect(result.event.data.reasoning).toEqual({
      level: 'unknown',
      source: 'unknown',
    })
  })

  it('omits session identity only through the explicit omit branch', () => {
    const result = createReviewedUsageMeasurementEventV1(codexCall(), {
      ...context(),
      session: { mode: 'omit' },
    })
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.event.data.sessionId).toBeUndefined()
    expect(result.event.data.quality.sessionIdentity).toBe('unknown')
  })

  it('creates an event with unavailable cost rather than dropping reviewed usage', () => {
    const result = createReviewedUsageMeasurementEventV1(
      codexCall({ model: 'metrora-unpriced-model', costUSD: 0 }),
      {
        ...context(),
        genAi: {
          ...context().genAi,
          requestModel: 'metrora-unpriced-model',
        },
      },
    )
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.event.data.cost).toEqual({ kind: 'unavailable' })
  })

  it('withholds unreviewed collectors and unsupported attribution', () => {
    expect(createReviewedUsageMeasurementEventV1(
      codexCall({ provider: 'zed' }),
      context(),
    )).toEqual({ status: 'withheld', reason: 'unreviewed-evidence-path' })

    expect(createReviewedUsageMeasurementEventV1(
      codexCall({ reasoningLevel: 'high', reasoningLevelSource: 'model-label' }),
      context(),
    ).status).toBe('created')

    expect(createReviewedUsageMeasurementEventV1(
      {
        ...codexCall(),
        provider: 'claude',
        reasoningLevelSource: 'explicit',
      },
      context(),
    )).toEqual({ status: 'withheld', reason: 'unreviewed-evidence-path' })

    expect(createReviewedUsageMeasurementEventV1(
      geminiCall({ reasoningLevel: 'high', reasoningLevelSource: 'explicit' }),
      {
        ...context(),
        genAi: {
          operationName: 'invoke_agent',
          providerName: 'google',
          requestModel: 'gemini-2.5-flash',
        },
      },
    )).toEqual({ status: 'withheld', reason: 'unreviewed-evidence-path' })
  })

  it('never serializes rich internal call details', () => {
    const result = createReviewedUsageMeasurementEventV1(codexCall(), context())
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    const serialized = JSON.stringify(result.event)
    expect(serialized).not.toContain('private-message-id')
    expect(serialized).not.toContain('/private/secret.txt')
    expect(serialized).not.toContain('mcp__private__lookup')
    expect(serialized).not.toContain('private-skill')
    expect(serialized).not.toContain('reviewer')
  })

  it('rejects ambiguous or invalid session disclosure instead of guessing', () => {
    expect(() => createReviewedUsageMeasurementEventV1(codexCall(), {
      ...context(),
      session: { mode: 'include', sessionId: '' },
    })).toThrow(/included session id must be a non-empty string/)

    expect(() => createReviewedUsageMeasurementEventV1(codexCall(), {
      ...context(),
      session: { mode: 'omit', sessionId: 'hidden-session' } as never,
    })).toThrow(/omitted session disclosure cannot carry a session id/)

    expect(() => createReviewedUsageMeasurementEventV1(codexCall(), {
      ...context(),
      session: { mode: 'later' } as never,
    })).toThrow(/session disclosure mode must be omit or include/)
  })

  it('requires explicit valid provider, operation, source and endpoint facts', () => {
    expect(() => createReviewedUsageMeasurementEventV1(codexCall(), {
      ...context(),
      genAi: { ...context().genAi, providerName: '' },
    })).toThrow()

    expect(() => createReviewedUsageMeasurementEventV1(codexCall(), {
      ...context(),
      collector: { ...context().collector, sourceFingerprintSha256: 'not-a-digest' },
    })).toThrow()

    expect(() => createReviewedUsageMeasurementEventV1(codexCall(), {
      ...context(),
      eventIdentityKey: new Uint8Array(31),
    })).toThrow(/at least 32 bytes/)
  })

  it('keeps event identity deterministic for stable endpoint evidence', () => {
    const first = createReviewedUsageMeasurementEventV1(codexCall(), context())
    const second = createReviewedUsageMeasurementEventV1(codexCall(), context())
    expect(first.status).toBe('created')
    expect(second.status).toBe('created')
    if (first.status !== 'created' || second.status !== 'created') return
    expect(first.event.id).toBe(second.event.id)
  })
})
