import { describe, expect, it } from 'vitest'

import {
  MODELS_DEV_SNAPSHOT_CAPTURED_AT,
  MODELS_DEV_SNAPSHOT_REVISION,
  MODELS_DEV_SNAPSHOT_SOURCE,
  reviewedModelsDevCapability,
  reviewedModelsDevMetadata,
} from './models-dev-capabilities'

const reviewed = [
  {
    model: 'mimo-v2.5-free',
    protocol: 'openai-chat',
    providerPackage: '@ai-sdk/openai-compatible',
    providerFamily: 'openai-compatible',
    endpointFamily: 'chat-completions',
    toolCall: 'supported',
    reasoning: true,
    reasoningEfforts: ['default'],
    reasoningParameter: 'openai-effort',
    interleavedField: 'reasoning_content',
    contextTokens: 200_000,
    outputTokens: 32_000,
  },
  {
    model: 'muse-spark-1.2-contributor-free',
    baseModel: 'meta/muse-spark-1.2',
    protocol: 'openai-responses',
    providerPackage: '@ai-sdk/openai',
    providerFamily: 'openai',
    endpointFamily: 'responses',
    toolCall: 'supported',
    reasoning: true,
    reasoningEfforts: ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    reasoningParameter: 'reasoning-object',
    contextTokens: 1_048_576,
    outputTokens: 131_072,
  },
  {
    model: 'nemotron-3-ultra-free',
    protocol: 'openai-chat',
    providerPackage: '@ai-sdk/openai-compatible',
    providerFamily: 'openai-compatible',
    endpointFamily: 'chat-completions',
    toolCall: 'supported',
    reasoning: true,
    reasoningEfforts: ['default'],
    reasoningParameter: 'openai-effort',
    interleavedField: 'reasoning_content',
    contextTokens: 1_000_000,
    outputTokens: 128_000,
  },
] as const

describe('reviewed Models.dev capability projections', () => {
  it('binds the projection to the reviewed source revision', () => {
    expect({ source: MODELS_DEV_SNAPSHOT_SOURCE, revision: MODELS_DEV_SNAPSHOT_REVISION, capturedAt: MODELS_DEV_SNAPSHOT_CAPTURED_AT }).toEqual({
      source: 'anomalyco/models.dev',
      revision: '03c2631946bb7ce2735e8e37d04197c4b910ff66',
      capturedAt: '2026-09-02',
    })
  })

  it.each(reviewed)('keeps the exact resolved %s projection', expected => {
    expect(reviewedModelsDevCapability('opencode-zen', expected.model)).toEqual({ provider: 'opencode-zen', ...expected })
  })

  it('resolves Muse limits from the base model rather than the thin provider override', () => {
    const muse = reviewedModelsDevCapability('opencode-zen', 'muse-spark-1.2-contributor-free')!
    expect(muse.contextTokens).toBe(1_048_576)
    expect(muse.outputTokens).toBe(131_072)
    expect(reviewedModelsDevMetadata(muse)).toEqual({
      base_model: 'meta/muse-spark-1.2',
      provider: { npm: '@ai-sdk/openai', family: 'openai' },
      endpointFamily: 'responses',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['minimal', 'low', 'medium', 'high', 'xhigh'] }],
      reasoningParameter: 'reasoning-object',
      tool_call: true,
    })
  })
})
