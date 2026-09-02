import { describe, expect, it } from 'vitest'

import type { ParsedApiCall } from '../../types.js'
import {
  toUsageMeasurementEventV1,
  type ParsedApiCallMeasurementContextV1,
} from './measurement-adapter.js'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const EVENT_KEY_A = new Uint8Array(32).fill(0x5a)
const EVENT_KEY_B = new Uint8Array(32).fill(0xa5)

function call(overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  return {
    provider: 'codex',
    model: 'gpt-5.6-luna',
    reasoningLevel: 'xhigh',
    reasoningLevelSource: 'explicit',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 4,
      cacheReadInputTokens: 40,
      cachedInputTokens: 40,
      reasoningTokens: 5,
      webSearchRequests: 0,
    },
    costUSD: 0.0012,
    tools: ['Read', 'Edit'],
    mcpTools: ['mcp__secret__lookup'],
    skills: ['private-skill'],
    subagentTypes: ['reviewer'],
    hasAgentSpawn: true,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: '2026-07-31T12:00:00.000Z',
    bashCommands: ['cat /home/fixture/private/token.txt'],
    deduplicationKey: 'private-provider-message-id',
    toolSequence: [[{ tool: 'Read', file: '/home/fixture/private/token.txt' }]],
    ...overrides,
  }
}

function context(
  overrides: Partial<ParsedApiCallMeasurementContextV1> = {},
): ParsedApiCallMeasurementContextV1 {
  return {
    workspaceId: 'workspace_01',
    endpointId: 'endpoint_01',
    eventIdentityKey: EVENT_KEY_A,
    repositoryId: 'repository_01',
    projectId: 'project_01',
    sessionId: 'session_01',
    accountId: 'account_01',
    tool: { name: 'Codex', version: '1.0.0' },
    collector: {
      adapterId: 'adapter_codex',
      adapterVersion: '1.0.0',
      sourceKind: 'jsonl-session',
      sourceFingerprintSha256: SHA_A,
    },
    genAi: {
      operationName: 'invoke_agent',
      providerName: 'openai',
      requestModel: 'gpt-5.6-luna',
    },
    costEvidence: { kind: 'estimated', method: 'token-pricing' },
    quality: {
      tokenCounts: 'measured',
      modelIdentity: 'exact',
      sessionIdentity: 'exact',
    },
    ...overrides,
  }
}

describe('ParsedApiCall -> UsageMeasurementEventV1', () => {
  it('projects only the public allowlist and preserves explicit provenance', () => {
    const event = toUsageMeasurementEventV1(call(), context())

    expect(event.subject).toBe('workspace/workspace_01/endpoint/endpoint_01')
    expect(event.data.genAi).toEqual({
      operationName: 'invoke_agent',
      providerName: 'openai',
      requestModel: 'gpt-5.6-luna',
      responseModel: 'gpt-5.6-luna',
    })
    expect(event.data.usage).toEqual({
      calls: 1,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 4,
      reasoningTokens: 5,
    })
    expect(event.data.cost).toEqual({
      kind: 'estimated',
      amountMicrosUsd: 1200,
      method: 'token-pricing',
    })
    expect(event.data.reasoning).toEqual({ level: 'xhigh', source: 'explicit' })
    expect(event.data.privacy).toEqual({
      promptsIncluded: false,
      responsesIncluded: false,
      sourceCodeIncluded: false,
      patchesIncluded: false,
      secretsIncluded: false,
      localPathsIncluded: false,
    })

    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('private-provider-message-id')
    expect(serialized).not.toContain('/home/fixture/private/token.txt')
    expect(serialized).not.toContain('mcp__secret__lookup')
    expect(serialized).not.toContain('private-skill')
    expect(serialized).not.toContain('reviewer')
    expect(serialized).not.toContain('eventIdentityKey')
  })

  it('creates a deterministic keyed event id without exposing or guessably hashing the dedup key', () => {
    const first = toUsageMeasurementEventV1(call(), context())
    const second = toUsageMeasurementEventV1(call(), context())
    const differentCall = toUsageMeasurementEventV1(
      call({ deduplicationKey: 'different-private-id' }),
      context(),
    )
    const differentSource = toUsageMeasurementEventV1(
      call(),
      context({
        collector: {
          ...context().collector,
          sourceFingerprintSha256: SHA_B,
        },
      }),
    )
    const rotatedKey = toUsageMeasurementEventV1(
      call(),
      context({ eventIdentityKey: EVENT_KEY_B }),
    )

    expect(first.id).toBe(second.id)
    expect(first.id).toMatch(/^evt_[a-f0-9]{64}$/)
    expect(differentCall.id).not.toBe(first.id)
    expect(differentSource.id).not.toBe(first.id)
    expect(rotatedKey.id).not.toBe(first.id)
  })

  it('requires a non-empty source identity and at least 256 bits of local key material', () => {
    expect(() => toUsageMeasurementEventV1(
      call(),
      context({ eventIdentityKey: new Uint8Array(31) }),
    )).toThrow(/at least 32 bytes/)

    expect(() => toUsageMeasurementEventV1(
      call({ deduplicationKey: '' }),
      context(),
    )).toThrow(/must not be empty/)
  })

  it('never invents a zero cost when evidence says cost is unavailable', () => {
    const event = toUsageMeasurementEventV1(
      call({ costUSD: Number.NaN }),
      context({ costEvidence: { kind: 'unavailable' } }),
    )
    expect(event.data.cost).toEqual({ kind: 'unavailable' })
  })

  it('requires finite, non-negative and exactly representable money when an amount is claimed', () => {
    expect(() => toUsageMeasurementEventV1(
      call({ costUSD: Number.NaN }),
      context({ costEvidence: { kind: 'estimated', method: 'token-pricing' } }),
    )).toThrow(/finite, non-negative/)

    expect(() => toUsageMeasurementEventV1(
      call({ costUSD: -1 }),
      context({ costEvidence: { kind: 'metered', source: 'provider' } }),
    )).toThrow(/finite, non-negative/)

    expect(() => toUsageMeasurementEventV1(
      call({ costUSD: Number.MAX_SAFE_INTEGER / 1_000_000 + 1 }),
      context({ costEvidence: { kind: 'metered', source: 'billing-export' } }),
    )).toThrow(/safe integer micro-USD range/)
  })

  it('keeps absent reasoning explicitly unknown and rejects half-attributed data', () => {
    const unknown = toUsageMeasurementEventV1(
      call({ reasoningLevel: undefined, reasoningLevelSource: undefined }),
      context(),
    )
    expect(unknown.data.reasoning).toEqual({ level: 'unknown', source: 'unknown' })

    expect(() => toUsageMeasurementEventV1(
      call({ reasoningLevel: 'high', reasoningLevelSource: undefined }),
      context(),
    )).toThrow(/must be present together/)
  })

  it('requires unknown session quality when no session identifier is exported', () => {
    expect(() => toUsageMeasurementEventV1(
      call(),
      context({ sessionId: undefined }),
    )).toThrow(/session identity quality must be unknown/)

    const event = toUsageMeasurementEventV1(
      call(),
      context({
        sessionId: undefined,
        quality: {
          tokenCounts: 'measured',
          modelIdentity: 'exact',
          sessionIdentity: 'unknown',
        },
      }),
    )
    expect(event.data.sessionId).toBeUndefined()
    expect(event.data.quality.sessionIdentity).toBe('unknown')
  })

  it('does not hide invalid optional fields by silently omitting them', () => {
    expect(() => toUsageMeasurementEventV1(
      call(),
      context({ repositoryId: '' }),
    )).toThrow()

    expect(() => toUsageMeasurementEventV1(
      call(),
      context({ tool: { name: 'Codex', version: '' } }),
    )).toThrow()

    expect(() => toUsageMeasurementEventV1(
      call(),
      context({
        genAi: {
          operationName: 'invoke_agent',
          providerName: 'openai',
          requestModel: '',
        },
      }),
    )).toThrow()
  })

  it('lets the public schema reject invalid token facts instead of coercing them', () => {
    expect(() => toUsageMeasurementEventV1(
      call({
        usage: {
          ...call().usage,
          inputTokens: -1,
        },
      }),
      context(),
    )).toThrow()
  })
})
