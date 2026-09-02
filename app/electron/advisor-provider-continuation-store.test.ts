import { describe, expect, it } from 'vitest'

import {
  HOSTED_CONTINUATION_ADAPTER,
  HOSTED_CONTINUATION_RESPONSES_ADAPTER,
  type AdvisorHostedContinuationPayload,
} from './advisor-provider-continuation'
import {
  createHostedContinuationStore,
  HOSTED_CONTINUATION_TTL_MS,
  MAX_HOSTED_CONTINUATION_STORE_BYTES,
  MAX_LIVE_HOSTED_CONTINUATIONS,
} from './advisor-provider-continuation-store'

const identity = {
  provider: 'opencode-zen' as const,
  model: 'mimo-v2.5-free',
  protocol: 'openai-chat' as const,
  adapter: HOSTED_CONTINUATION_ADAPTER,
}

function payload(model = identity.model): AdvisorHostedContinuationPayload {
  return {
    ...identity,
    model,
    responseMessages: [{
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'private provider reasoning' },
        { type: 'tool-call', toolCallId: 'mimo-call-1', toolName: 'get_spend_snapshot', input: { provider: 'all' } },
      ],
    }],
  }
}

describe('Electron hosted provider continuation store', () => {
  it('returns only an opaque reference and preserves exact internal payload for retry/replacement', () => {
    let id = 0
    const store = createHostedContinuationStore({ idFactory: () => 'opaque-ref-' + (++id) })
    try {
      const reference = store.put(payload())!
      expect(Object.keys(reference).sort()).toEqual(['adapter', 'id', 'model', 'protocol', 'provider'])
      expect(JSON.stringify(reference)).not.toContain('private provider reasoning')

      const resolved = store.acquire(reference, identity)!
      expect(JSON.stringify(resolved)).toContain('private provider reasoning')
      expect(resolved.responseMessages[0]).toMatchObject({ role: 'assistant' })

      // A failed provider attempt releases, rather than destroys, the entry.
      store.release(reference)
      expect(store.acquire({ ...reference, model: 'other-model' }, { ...identity, model: 'other-model' })).toBeNull()
      expect(store.acquire(reference, identity)).toBeTruthy()

      const replacement = store.replace(reference, payload())!
      expect(replacement.id).not.toBe(reference.id)
      expect(store.acquire(reference, identity)).toBeNull()
      expect(store.acquire(replacement, identity)).toBeTruthy()
    } finally {
      store.dispose()
    }
  })

  it('expires, retires, and bounds entries without persisting provider payloads', () => {
    let timestamp = 0
    let id = 0
    const store = createHostedContinuationStore({
      now: () => timestamp,
      ttlMs: 10,
      maxEntries: 1,
      idFactory: () => 'opaque-ref-' + (++id),
    })
    try {
      const reference = store.put(payload())!
      expect(store.stats().entries).toBe(1)
      expect(store.put(payload('second-model'))).toBeNull()
      timestamp = 11
      expect(store.stats()).toEqual({ entries: 0, bytes: 0 })
      expect(store.acquire(reference, identity)).toBeNull()

      const fresh = store.put(payload())!
      store.retire(fresh)
      expect(store.acquire(fresh, identity)).toBeNull()
    } finally {
      store.dispose()
    }
  })

  it('enforces the configured byte bound and the production bounds stay finite', () => {
    const tiny = createHostedContinuationStore({ maxBytes: 1 })
    try {
      expect(tiny.put(payload())).toBeNull()
      expect(tiny.stats().entries).toBe(0)
    } finally {
      tiny.dispose()
    }
    expect(MAX_LIVE_HOSTED_CONTINUATIONS).toBeGreaterThan(0)
    expect(MAX_HOSTED_CONTINUATION_STORE_BYTES).toBeGreaterThan(64 * 1024)
    expect(HOSTED_CONTINUATION_TTL_MS).toBeGreaterThan(0)
  })

  it('keeps bounded Responses metadata in Electron while returning only an opaque reference', () => {
    const responsesIdentity = {
      provider: 'opencode-zen' as const,
      model: 'muse-spark-1.2-contributor-free',
      protocol: 'openai-responses' as const,
      adapter: HOSTED_CONTINUATION_RESPONSES_ADAPTER,
    }
    const store = createHostedContinuationStore({ idFactory: () => 'opaque-responses-ref' })
    try {
      const reference = store.put({
        ...responsesIdentity,
        responseMessages: [{
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'private reasoning', providerMetadata: { openai: { itemId: 'rs-1', reasoningEncryptedContent: 'encrypted-reasoning' } } },
            { type: 'tool-call', toolCallId: 'responses-call-1', toolName: 'get_spend_snapshot', input: {}, providerMetadata: { openai: { itemId: 'fc-1' } } },
          ],
        }],
      })!

      expect(Object.keys(reference).sort()).toEqual(['adapter', 'id', 'model', 'protocol', 'provider'])
      expect(JSON.stringify(reference)).not.toContain('encrypted-reasoning')
      expect(store.acquire(reference, responsesIdentity)).toMatchObject({ protocol: 'openai-responses', adapter: HOSTED_CONTINUATION_RESPONSES_ADAPTER })
    } finally {
      store.dispose()
    }
  })
})
