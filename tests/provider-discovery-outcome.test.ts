import { describe, expect, it } from 'vitest'
import {
  ProviderDiscoveryPartialError,
  classifyProviderDiscoveryOutcome,
} from '../src/providers/discovery-outcome.js'
import {
  discoverAllSessionsWithOutcomes,
  discoverProviderWithOutcome,
} from '../src/providers/index.js'
import type { Provider, SessionSource } from '../src/providers/types.js'

function source(provider: string, path: string): SessionSource {
  return { provider, path, project: provider + '-project' }
}

function fakeProvider(name: string, discoverSessions: Provider['discoverSessions']): Provider {
  return {
    name,
    displayName: name,
    modelDisplayName: value => value,
    toolDisplayName: value => value,
    discoverSessions,
  }
}

describe('provider discovery outcome v1', () => {
  it('distinguishes success, empty, unavailable, failed, partial and cancelled', () => {
    const valid = source('alpha', '/alpha.jsonl')
    expect(classifyProviderDiscoveryOutcome('alpha', { sources: [valid] })).toMatchObject({ status: 'success', complete: true, sourceCount: 1 })
    expect(classifyProviderDiscoveryOutcome('alpha', { sources: [valid, source('alpha', '/second.jsonl')] })).toMatchObject({ status: 'success', complete: true, sourceCount: 2 })
    expect(classifyProviderDiscoveryOutcome('alpha')).toMatchObject({ status: 'empty', complete: true, sourceCount: 0 })
    expect(classifyProviderDiscoveryOutcome('alpha', { error: Object.assign(new Error('permission denied'), { code: 'EACCES' }) })).toMatchObject({ status: 'unavailable', complete: false, diagnostic: { code: 'provider-unavailable' } })
    expect(classifyProviderDiscoveryOutcome('alpha', { error: new Error('parser blew up') })).toMatchObject({ status: 'failed', complete: false, diagnostic: { code: 'discovery-failed' } })
    expect(classifyProviderDiscoveryOutcome('alpha', { error: new ProviderDiscoveryPartialError([valid]) })).toMatchObject({ status: 'partial', complete: false, sourceCount: 1, diagnostic: { code: 'partial-discovery' } })
    expect(classifyProviderDiscoveryOutcome('alpha', { sources: [valid, { path: '', project: 'bad', provider: 'alpha' } as SessionSource] })).toMatchObject({ status: 'partial', complete: false, sourceCount: 1, diagnostic: { code: 'invalid-source' } })
    expect(classifyProviderDiscoveryOutcome('alpha', { sources: [valid], cancelled: true })).toMatchObject({ status: 'cancelled', complete: false, sourceCount: 1, diagnostic: { code: 'cancelled' } })
  })

  it('preserves known unavailable sources without exposing raw error details', async () => {
    const outcome = await discoverProviderWithOutcome(fakeProvider('locked', async () => {
      throw Object.assign(new Error('C:\\Users\\private\\secret.db'), { code: 'EACCES' })
    }))
    expect(outcome.status).toBe('unavailable')
    expect(outcome.diagnostic?.message).not.toContain('secret.db')
  })

  it('returns cancelled when the caller aborts before truthful completion', async () => {
    const controller = new AbortController()
    const pending = discoverProviderWithOutcome(fakeProvider('slow', async () => await new Promise<SessionSource[]>(() => undefined)), controller.signal)
    controller.abort()
    await expect(pending).resolves.toMatchObject({ provider: 'slow', status: 'cancelled', complete: false })
  })

  it('isolates providers and returns deterministic provider ordering', async () => {
    const result = await discoverAllSessionsWithOutcomes('all', [
      fakeProvider('zeta', async () => [source('zeta', '/zeta.jsonl')]),
      fakeProvider('broken', async () => { throw new Error('boom') }),
      fakeProvider('alpha', async () => [source('alpha', '/alpha.jsonl')]),
    ])
    expect(result.schemaVersion).toBe('metrora.provider-discovery-outcome.v1')
    expect(result.outcomes.map(item => item.provider)).toEqual(['alpha', 'broken', 'zeta'])
    expect(result.sources.map(item => item.path)).toEqual(['/alpha.jsonl', '/zeta.jsonl'])
    expect(result.complete).toBe(false)
    expect(result.outcomes.find(item => item.provider === 'broken')).toMatchObject({ status: 'failed', complete: false })
  })
})
