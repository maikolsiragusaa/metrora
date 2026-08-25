import { describe, expect, it } from 'vitest'

import { quotaProviderConnect, quotaProviderName, quotaProviderOwner, quotaSourceLabel } from './quota-providers'

describe('capacity provider presentation', () => {
  it('uses mainstream provider names and owners', () => {
    expect(quotaProviderName('claude')).toBe('Claude')
    expect(quotaProviderName('codex')).toBe('Codex')
    expect(quotaProviderName('copilot')).toBe('GitHub Copilot')
    expect(quotaProviderName('kimi')).toBe('Kimi Code')
    expect(quotaProviderName('antigravity')).toBe('Antigravity')
    expect(quotaProviderOwner('copilot')).toBe('GitHub')
    expect(quotaProviderOwner('kimi')).toBe('Moonshot AI')
    expect(quotaProviderOwner('antigravity')).toBe('Google')
  })

  it('keeps connect guidance provider-owned and does not invent Metrora login flows', () => {
    expect('command' in quotaProviderConnect('copilot')).toBe(false)
    expect('command' in quotaProviderConnect('antigravity')).toBe(false)
    expect(quotaProviderConnect('kimi').command).toBe('kimi')
  })

  it('distinguishes transport provenance without changing factual authority', () => {
    expect(quotaSourceLabel(undefined)).toBe('Provider-reported')
    expect(quotaSourceLabel({ kind: 'provider-api', stability: 'documented' })).toBe('Provider API · Documented')
    expect(quotaSourceLabel({ kind: 'provider-internal-api', stability: 'experimental' })).toBe('Provider client API · Experimental')
    expect(quotaSourceLabel({ kind: 'provider-loopback', stability: 'experimental' })).toBe('Local provider service · Experimental')
  })
})
