import { describe, expect, it } from 'vitest'

import { buildQuotaEvidence, scopeLabel } from './evidence'
import { contentMinimalEvidence, contentMinimalEvidenceRefs, contentMinimalScope } from './privacy'
import type { AdvisorScope } from './types'
import type { QuotaProvider } from '../lib/types'

function scope(provider: string): AdvisorScope {
  return {
    period: '30days',
    range: null,
    provider,
    projectId: 'all',
    projectName: 'All projects',
    model: null,
  }
}

function quota(provider: QuotaProvider['provider']): QuotaProvider {
  return {
    schemaVersion: 1,
    provider,
    authority: 'provider-reported',
    availability: 'available',
    connection: 'connected',
    freshness: 'fresh',
    observedAt: '2026-08-25T12:00:00.000Z',
    planLabel: 'Pro',
    windows: [{ id: 'weekly', label: 'Weekly', usedFraction: 0.25, resetsAt: '2026-08-30T12:00:00.000Z', windowSeconds: 604_800 }],
    credits: null,
    rateLimit: { state: 'clear', retryAt: null },
  }
}

describe('Advisor expanded Capacity evidence', () => {
  it('keeps the new quota providers inside the closed model-facing allowlist', () => {
    for (const provider of ['copilot', 'kimi', 'antigravity']) {
      expect(contentMinimalScope(scope(provider)).provider).toBe(provider)
    }
    expect(contentMinimalScope(scope('arbitrary-provider')).provider).toBe('[provider]')
  })

  it('preserves safe quota evidence ids for the new providers but not arbitrary ids', () => {
    const refs = contentMinimalEvidenceRefs([
      { id: 'quota.copilot', label: 'GitHub Copilot provider quota snapshot', source: 'quota' },
      { id: 'quota.kimi', label: 'Kimi Code provider quota snapshot', source: 'quota' },
      { id: 'quota.antigravity', label: 'Antigravity provider quota snapshot', source: 'quota' },
      { id: 'quota.secret-provider', label: 'Unknown provider quota snapshot', source: 'quota' },
    ], { preserveIds: true })
    expect(refs.map(ref => ref.id)).toEqual(['quota.copilot', 'quota.kimi', 'quota.antigravity', 'evidence-4'])
  })

  it('builds mainstream labels and exposes canonical new-provider facts through the privacy projection', () => {
    const cases: Array<[QuotaProvider['provider'], string]> = [
      ['copilot', 'GitHub Copilot'],
      ['kimi', 'Kimi Code'],
      ['antigravity', 'Antigravity'],
    ]
    for (const [provider, display] of cases) {
      const advisorScope = scope(provider)
      const evidence = buildQuotaEvidence(`What quota remains on ${display}?`, advisorScope, null, [quota(provider)])
      expect(evidence.refs[0]).toMatchObject({ id: `quota.${provider}`, label: `${display} provider quota snapshot`, source: 'quota' })
      expect(scopeLabel(advisorScope)).toContain(display)

      const projected = contentMinimalEvidence(evidence, { preserveEvidenceIds: true }) as any
      expect(projected.scope.provider).toBe(provider)
      expect(projected.refs[0].id).toBe(`quota.${provider}`)
      expect(projected.quota.providers).toEqual([
        expect.objectContaining({
          provider,
          planLabel: 'Pro',
          freshness: 'fresh',
          windows: [expect.objectContaining({ label: 'Weekly', usedPercent: 25, remainingPercent: 75 })],
        }),
      ])
    }
  })
})
