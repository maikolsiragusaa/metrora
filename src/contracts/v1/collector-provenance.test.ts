import { describe, expect, it } from 'vitest'

import { PROVIDER_PARSE_VERSIONS } from '../../session-cache.js'
import {
  CLAUDE_JSONL_PROFILE_V1,
  CODEX_CONTENT_FALLBACK_PROFILE_V1,
  CODEX_TOKEN_COUNT_PROFILE_V1,
  CollectorProvenanceProfileV1Schema,
  CollectorProvenanceProfilesV1,
  collectorProvenanceProfileForCall,
} from './collector-provenance.js'

describe('collector provenance registry v1', () => {
  it('contains only the three reviewed Claude and Codex paths', () => {
    expect(CollectorProvenanceProfilesV1.map(profile => profile.profileId)).toEqual([
      'claude-jsonl-usage-v1',
      'codex-rollout-token-count-v1',
      'codex-rollout-content-fallback-v1',
    ])
    expect(new Set(CollectorProvenanceProfilesV1.map(profile => profile.profileId)).size).toBe(3)
  })

  it('fails review when an inherited parser version drifts', () => {
    expect(CLAUDE_JSONL_PROFILE_V1.parserVersion).toBe(PROVIDER_PARSE_VERSIONS['claude'])
    expect(CODEX_TOKEN_COUNT_PROFILE_V1.parserVersion).toBe(PROVIDER_PARSE_VERSIONS['codex'])
    expect(CODEX_CONTENT_FALLBACK_PROFILE_V1.parserVersion).toBe(PROVIDER_PARSE_VERSIONS['codex'])
  })

  it('classifies normalized calls without granting defaults to unknown paths', () => {
    expect(collectorProvenanceProfileForCall({ provider: 'claude' })).toBe(CLAUDE_JSONL_PROFILE_V1)
    expect(collectorProvenanceProfileForCall({ provider: 'claude', isEstimated: true })).toBeUndefined()
    expect(collectorProvenanceProfileForCall({ provider: 'codex', isEstimated: false })).toBe(CODEX_TOKEN_COUNT_PROFILE_V1)
    expect(collectorProvenanceProfileForCall({ provider: 'codex', isEstimated: true })).toBe(CODEX_CONTENT_FALLBACK_PROFILE_V1)
    expect(collectorProvenanceProfileForCall({ provider: 'zed' })).toBeUndefined()
    expect(collectorProvenanceProfileForCall({ provider: 'opencode' })).toBeUndefined()
    expect(collectorProvenanceProfileForCall({ provider: 'copilot' })).toBeUndefined()
  })

  it('describes token evidence per field instead of claiming universal measurement', () => {
    expect(CODEX_TOKEN_COUNT_PROFILE_V1.facts.tokens).toEqual({
      input: 'measured',
      output: 'measured',
      cacheRead: 'measured',
      cacheWrite: 'unknown',
      reasoning: 'measured',
    })
    expect(CODEX_CONTENT_FALLBACK_PROFILE_V1.facts.tokens).toEqual({
      input: 'estimated',
      output: 'estimated',
      cacheRead: 'unknown',
      cacheWrite: 'unknown',
      reasoning: 'unknown',
    })
    expect(CLAUDE_JSONL_PROFILE_V1.facts.tokens).toEqual({
      input: 'measured',
      output: 'measured',
      cacheRead: 'derived',
      cacheWrite: 'derived',
      reasoning: 'unknown',
    })
  })

  it('never presents locally priced cost as provider-metered evidence', () => {
    for (const profile of CollectorProvenanceProfilesV1) {
      expect(profile.facts.cost).toMatchObject({
        basis: 'local-token-pricing',
        metered: false,
        requiresPricingCoverage: true,
      })
    }
    expect(CODEX_CONTENT_FALLBACK_PROFILE_V1.facts.cost.tokenBasis).toBe('estimated-content-length')
  })

  it('keeps the v1 schema extensible without registering unreviewed collectors', () => {
    const futureMeteredProfile = {
      kind: 'qovrion.collector-provenance-profile',
      version: 1,
      profileId: 'future-metered-source-v1',
      collector: 'future-tool',
      parserVersion: 'reviewed-parser-v1',
      sourceKind: 'future-metered-ledger',
      facts: {
        tokens: {
          input: 'measured',
          output: 'measured',
          cacheRead: 'unknown',
          cacheWrite: 'unknown',
          reasoning: 'unknown',
        },
        modelIdentity: 'exact',
        sessionIdentity: 'exact',
        reasoningAttribution: ['unknown'],
        cost: {
          basis: 'provider-metered',
          tokenBasis: 'mixed',
          metered: true,
          requiresPricingCoverage: false,
        },
      },
      privacy: {
        promptsRequired: false,
        responsesRequired: false,
        sourceCodeRequired: false,
        patchesRequired: false,
        localPathsRequired: false,
      },
    }

    expect(CollectorProvenanceProfileV1Schema.safeParse(futureMeteredProfile).success).toBe(true)
    expect(CollectorProvenanceProfilesV1.some(profile => profile.collector === 'future-tool')).toBe(false)
  })

  it('rejects internally inconsistent cost provenance combinations', () => {
    expect(CollectorProvenanceProfileV1Schema.safeParse({
      ...CODEX_TOKEN_COUNT_PROFILE_V1,
      facts: {
        ...CODEX_TOKEN_COUNT_PROFILE_V1.facts,
        cost: {
          basis: 'provider-metered',
          tokenBasis: 'measured',
          metered: false,
          requiresPricingCoverage: true,
        },
      },
    }).success).toBe(false)
  })

  it('requires no raw content or local paths for any reviewed profile', () => {
    for (const profile of CollectorProvenanceProfilesV1) {
      expect(Object.values(profile.privacy).every(value => value === false)).toBe(true)
    }
  })

  it('freezes registry metadata deeply and rejects undeclared claims', () => {
    expect(Object.isFrozen(CollectorProvenanceProfilesV1)).toBe(true)
    expect(Object.isFrozen(CODEX_TOKEN_COUNT_PROFILE_V1)).toBe(true)
    expect(Object.isFrozen(CODEX_TOKEN_COUNT_PROFILE_V1.facts)).toBe(true)
    expect(Object.isFrozen(CODEX_TOKEN_COUNT_PROFILE_V1.facts.tokens)).toBe(true)

    expect(CollectorProvenanceProfileV1Schema.safeParse({
      ...CODEX_TOKEN_COUNT_PROFILE_V1,
      providerMeteredCost: true,
    }).success).toBe(false)
  })
})
