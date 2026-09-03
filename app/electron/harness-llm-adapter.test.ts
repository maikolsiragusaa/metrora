// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { harnessProviderRoute, MetroraLlmAdapter } from './harness-llm-adapter.mjs'

describe('Metrora DSH adapter model metadata', () => {
  it('exposes only the exact reasoning levels declared by the discovered route', async () => {
    const adapter = new MetroraLlmAdapter({
      resolveReasoningEfforts: (provider, model) => provider === harnessProviderRoute('ollama') && model === 'thinking-model' ? ['low', 'high'] : undefined,
    })
    const resolved = await adapter.resolveModel(harnessProviderRoute('ollama'), 'thinking-model')
    expect(resolved.reasoning?.efforts.map(effort => String(effort.id))).toEqual(['low', 'high'])
    const defaultModel = await adapter.resolveModel(harnessProviderRoute('ollama'), 'plain-model')
    expect(defaultModel.reasoning).toBeUndefined()
  })
})
