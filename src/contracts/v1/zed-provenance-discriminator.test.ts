import { describe, expect, it } from 'vitest'

import { collectorProvenanceProfileForCall } from './collector-provenance.js'

describe('Zed provenance discriminator', () => {
  it('requires a normalized source provider and a Zed-owned deduplication key', () => {
    expect(collectorProvenanceProfileForCall({
      provider: 'zed',
      modelProvider: 'Anthropic',
      deduplicationKey: 'zed:thread:request',
    })).toBeUndefined()

    expect(collectorProvenanceProfileForCall({
      provider: 'zed',
      modelProvider: 'anthropic',
      deduplicationKey: 'codex:thread:request',
    })).toBeUndefined()

    expect(collectorProvenanceProfileForCall({
      provider: 'zed',
      modelProvider: 'anthropic',
      deduplicationKey: 'zed:thread:request',
    })?.profileId).toBe('zed-request-token-usage-v1')
  })
})
