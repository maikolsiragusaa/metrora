import { describe, expect, it } from 'vitest'

import { calculateCost } from '../../models.js'
import type { ParsedApiCall } from '../../types.js'
import { createReviewedUsageMeasurementEventV1 } from './reviewed-event-factory.js'

const EVENT_KEY = new Uint8Array(32).fill(9)
const SOURCE_SHA = 'b'.repeat(64)

function zedCall(requestKey = 'request_1', overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 30,
    cachedInputTokens: 30,
    reasoningTokens: 0,
    webSearchRequests: 0,
  }
  const model = 'claude-sonnet-4-6'
  return {
    provider: 'zed',
    modelProvider: 'anthropic',
    model,
    usage,
    costUSD: calculateCost(
      model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheCreationInputTokens,
      usage.cacheReadInputTokens,
      usage.webSearchRequests,
    ),
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: '2026-07-31T18:00:00.000Z',
    bashCommands: [],
    deduplicationKey: `zed:thread-1:${requestKey}`,
    ...overrides,
  }
}

function context(providerName = 'Anthropic') {
  return {
    workspaceId: 'workspace_01',
    endpointId: 'endpoint_01',
    eventIdentityKey: EVENT_KEY,
    repositoryId: 'repository_01',
    projectId: 'project_01',
    session: { mode: 'include' as const, sessionId: 'thread-1' },
    tool: { name: 'Zed', version: '1.0.0' },
    collector: {
      adapterVersion: '0.9.19',
      sourceFingerprintSha256: SOURCE_SHA,
    },
    genAi: {
      operationName: 'invoke_agent' as const,
      providerName,
      requestModel: 'claude-sonnet-4-6',
    },
  }
}

describe('reviewed Zed event factory v1', () => {
  it('creates a request event using the provider recorded by Zed', () => {
    const result = createReviewedUsageMeasurementEventV1(zedCall(), context())
    expect(result.status).toBe('created')
    if (result.status !== 'created') return

    expect(result.profileId).toBe('zed-request-token-usage-v1')
    expect(result.event.data.collector).toMatchObject({
      adapterId: 'zed-request-token-usage-v1',
      sourceKind: 'zed-threads-sqlite-request-token-usage',
    })
    expect(result.event.data.genAi).toEqual({
      operationName: 'invoke_agent',
      providerName: 'anthropic',
      requestModel: 'claude-sonnet-4-6',
      responseModel: 'claude-sonnet-4-6',
    })
    expect(result.event.data.quality).toEqual({
      tokenCounts: 'measured',
      modelIdentity: 'exact',
      sessionIdentity: 'exact',
    })
  })

  it('creates a separately identified derived remainder event', () => {
    const result = createReviewedUsageMeasurementEventV1(
      zedCall('cumulative-remainder'),
      context('anthropic'),
    )
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.profileId).toBe('zed-cumulative-remainder-v1')
    expect(result.event.data.collector.sourceKind).toBe('zed-threads-sqlite-cumulative-remainder')
    expect(result.event.data.quality.tokenCounts).toBe('derived')
  })

  it('withholds a caller-supplied provider that conflicts with the Zed source', () => {
    expect(createReviewedUsageMeasurementEventV1(
      zedCall(),
      context('openai'),
    )).toEqual({ status: 'withheld', reason: 'model-provider-mismatch' })
  })

  it('withholds Zed calls that lack source-recorded provider identity', () => {
    expect(createReviewedUsageMeasurementEventV1(
      zedCall('request_1', { modelProvider: undefined }),
      context('anthropic'),
    )).toEqual({ status: 'withheld', reason: 'unreviewed-evidence-path' })
  })

  it('does not serialize the private deduplication key', () => {
    const result = createReviewedUsageMeasurementEventV1(zedCall(), context())
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(JSON.stringify(result.event)).not.toContain('zed:thread-1:request_1')
  })
})
