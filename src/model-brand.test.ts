import { describe, expect, it } from 'vitest'

import { normalizeModelBrandId, resolveModelBrandId } from './model-brand.js'

describe('model brand identity', () => {
  it('resolves OpenAI from a canonical GPT identity without using the route as a logo key', () => {
    expect(resolveModelBrandId({ canonicalIdentity: 'gpt-5.4' })).toBe('openai')
    expect(resolveModelBrandId({ modelOwner: 'openai' })).toBe('openai')
  })

  it('resolves Claude through Bedrock and Anthropic API as the same model vendor', () => {
    expect(resolveModelBrandId({ canonicalIdentity: 'claude-sonnet-4-6' })).toBe('anthropic')
    expect(resolveModelBrandId({ modelOwner: 'anthropic', canonicalIdentity: 'claude-sonnet-4-6' })).toBe('anthropic')
  })

  it('resolves reviewed Gemini, GLM and observed vendor canonical identities', () => {
    expect(resolveModelBrandId({ canonicalIdentity: 'gemini-2.5-pro' })).toBe('google')
    expect(resolveModelBrandId({ canonicalIdentity: 'glm-5p1' })).toBe('zai')
    expect(resolveModelBrandId({ canonicalIdentity: 'deepseek-v4-flash' })).toBe('deepseek')
    expect(resolveModelBrandId({ modelOwner: 'deepseek-ai' })).toBe('deepseek')
    expect(resolveModelBrandId({ canonicalIdentity: 'qwen3.7-plus' })).toBe('qwen')
    expect(resolveModelBrandId({ modelOwner: 'qwen' })).toBe('qwen')
    expect(resolveModelBrandId({ canonicalIdentity: 'moonshotai/kimi-k2.6' })).toBe('moonshot')
    expect(resolveModelBrandId({ modelOwner: 'moonshot' })).toBe('moonshot')
  })

  it('does not infer a brand from a route or an unknown/ambiguous identity', () => {
    expect(resolveModelBrandId({})).toBeUndefined()
    expect(resolveModelBrandId({ canonicalIdentity: 'model-a' })).toBeUndefined()
    expect(normalizeModelBrandId('codex')).toBeUndefined()
    expect(normalizeModelBrandId('OpenAI')).toBe('openai')
  })
})
