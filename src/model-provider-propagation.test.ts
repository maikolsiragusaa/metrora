import { describe, expect, it } from 'vitest'

import {
  apiCallToCachedCall,
  cachedCallToApiCall,
  providerCallToCachedCall,
  providerCallToTurn,
} from './parser.js'
import type { ParsedProviderCall } from './providers/types.js'

function providerCall(modelProvider?: string): ParsedProviderCall {
  return {
    provider: 'zed',
    model: 'gpt-5',
    ...(modelProvider ? { modelProvider } : {}),
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationInputTokens: 3,
    cacheReadInputTokens: 4,
    cachedInputTokens: 4,
    reasoningTokens: 0,
    webSearchRequests: 0,
    costUSD: 0.001,
    tools: [],
    bashCommands: [],
    timestamp: '2026-07-31T18:00:00.000Z',
    speed: 'standard',
    deduplicationKey: 'zed:thread:request',
    userMessage: 'test',
    sessionId: 'thread',
  }
}

describe('model provider propagation', () => {
  it('preserves an explicit source provider across normalized and cached calls', () => {
    const call = providerCall('openai')
    const turnCall = providerCallToTurn(call).assistantCalls[0]!
    expect(turnCall.modelProvider).toBe('openai')

    const providerCached = providerCallToCachedCall(call)
    expect(providerCached.modelProvider).toBe('openai')
    expect(cachedCallToApiCall(providerCached).modelProvider).toBe('openai')

    const apiCached = apiCallToCachedCall(turnCall)
    expect(apiCached.modelProvider).toBe('openai')
    expect(cachedCallToApiCall(apiCached).modelProvider).toBe('openai')
  })

  it('does not invent a provider when the collector did not record one', () => {
    const call = providerCall()
    expect(providerCallToTurn(call).assistantCalls[0]!.modelProvider).toBeUndefined()
    expect(providerCallToCachedCall(call).modelProvider).toBeUndefined()
  })
})
