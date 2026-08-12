import { describe, expect, it } from 'vitest'

import {
  CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE,
  CanonicalCollectorIdentityIntegrityError,
  COPILOT_CANONICAL_COLLECTOR,
  COPILOT_CHAT_JOURNAL_PROVIDER,
  COPILOT_CLI_RESUME_PROVIDER,
  assertCanonicalCollectorIdentity,
  canonicalCollectorForStorageNamespace,
} from './provider-parse-authorities.js'

describe('canonical collector identity authority', () => {
  it('registers only the two intentional Copilot storage-namespace mismatches', () => {
    expect(CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE).toEqual({
      [COPILOT_CHAT_JOURNAL_PROVIDER]: COPILOT_CANONICAL_COLLECTOR,
      [COPILOT_CLI_RESUME_PROVIDER]: COPILOT_CANONICAL_COLLECTOR,
    })
  })

  it('preserves ordinary section identity', () => {
    expect(canonicalCollectorForStorageNamespace('codex')).toBe('codex')
    expect(assertCanonicalCollectorIdentity({
      storageNamespace: 'codex',
      callProvider: 'codex',
    })).toBe('codex')
  })

  it('canonicalizes both internal Copilot lanes without changing their storage names', () => {
    for (const storageNamespace of [COPILOT_CHAT_JOURNAL_PROVIDER, COPILOT_CLI_RESUME_PROVIDER]) {
      expect(canonicalCollectorForStorageNamespace(storageNamespace)).toBe(COPILOT_CANONICAL_COLLECTOR)
      expect(assertCanonicalCollectorIdentity({ storageNamespace, callProvider: 'copilot' })).toBe('copilot')
    }
  })

  it('fails closed for unregistered aliases and contradictory registered calls', () => {
    expect(() => assertCanonicalCollectorIdentity({
      storageNamespace: 'copilot-artificial-alias',
      callProvider: 'copilot',
    })).toThrow(CanonicalCollectorIdentityIntegrityError)
    expect(() => assertCanonicalCollectorIdentity({
      storageNamespace: COPILOT_CHAT_JOURNAL_PROVIDER,
      callProvider: COPILOT_CHAT_JOURNAL_PROVIDER,
    })).toThrow(CanonicalCollectorIdentityIntegrityError)
  })
})
