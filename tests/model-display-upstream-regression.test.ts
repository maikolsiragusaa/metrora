import { describe, expect, it } from 'vitest'

import { getShortModelName } from '../src/models.js'

describe('model display labels from reviewed upstream delta', () => {
  it('keeps GPT-5.6 variants distinct instead of inventing a generic family label', () => {
    expect(getShortModelName('gpt-5.6-sol')).toBe('GPT-5.6 Sol')
    expect(getShortModelName('gpt-5.6-terra')).toBe('GPT-5.6 Terra')
    expect(getShortModelName('gpt-5.6-luna')).toBe('GPT-5.6 Luna')
    expect(getShortModelName('gpt-5.6-unlisted')).toBe('gpt-5.6-unlisted')
  })

  it('names Grok 4.5 without disturbing Grok Build', () => {
    expect(getShortModelName('grok-4.5')).toBe('Grok 4.5')
    expect(getShortModelName('grok-build-0.1')).toBe('Grok Build')
  })

  it('names ClinePass-routed slugs through the existing path fallback', () => {
    expect(getShortModelName('cline-pass/qwen3.7-max')).toBe('Qwen 3.7 Max')
    expect(getShortModelName('cline-pass/minimax-m3')).toBe('MiniMax M3')
    expect(getShortModelName('cline-pass/mimo-v2.5-pro')).toBe('MiMo v2.5 Pro')
    expect(getShortModelName('cline-pass/kimi-k3')).toBe('Kimi K3')
  })

  it('normalizes MiniMax M3 display spelling without changing pricing lookup', () => {
    expect(getShortModelName('minimax-m3')).toBe('MiniMax M3')
    expect(getShortModelName('MiniMax-M3')).toBe('MiniMax M3')
  })
})
