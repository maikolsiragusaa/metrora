import { describe, expect, it } from 'vitest'
import { normalizeExplicitModelProvider } from './model-provider.js'

describe('normalizeExplicitModelProvider', () => {
  it('normalizes explicit identifiers', () => {
    expect(normalizeExplicitModelProvider(' Anthropic ')).toBe('anthropic')
    expect(normalizeExplicitModelProvider('ZED.DEV')).toBe('zed.dev')
  })

  it('rejects malformed claims', () => {
    expect(normalizeExplicitModelProvider(undefined)).toBeUndefined()
    expect(normalizeExplicitModelProvider('openai/gpt-5')).toBeUndefined()
    expect(normalizeExplicitModelProvider('provider name')).toBeUndefined()
  })
})
