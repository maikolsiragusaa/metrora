import { describe, expect, it, vi } from 'vitest'
import {
  ProviderDiscoveryPartialError,
  ProviderDiscoveryTimeoutError,
  classifyProviderDiscoveryOutcome,
} from '../src/providers/discovery-outcome.js'
import {
  discoverAllSessionsWithOutcomes,
  discoverAllSessionsForFreshness,
  discoverProviderWithOutcome,
} from '../src/providers/index.js'
import type { Provider, SessionSource } from '../src/providers/types.js'

import {
  CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE,
  COPILOT_CANONICAL_COLLECTOR,
} from '../src/provider-parse-authorities.js'

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
    expect(classifyProviderDiscoveryOutcome('alpha', { error: new ProviderDiscoveryTimeoutError() })).toMatchObject({
      status: 'timed-out',
      complete: false,
      diagnostic: { code: 'discovery-timeout' },
    })
  })

  it('validates source providers against canonical collector authority', () => {
    const mismatched = classifyProviderDiscoveryOutcome('alpha', { sources: [source('beta', '/beta.jsonl')] })
    expect(mismatched).toMatchObject({ status: 'failed', complete: false, sourceCount: 0, diagnostic: { code: 'invalid-source' } })
    expect(mismatched.sources).toEqual([])

    const sameProvider = classifyProviderDiscoveryOutcome('alpha', { sources: [source('alpha', '/same.jsonl')] })
    expect(sameProvider).toMatchObject({ status: 'success', complete: true, sourceCount: 1 })

    const copilotNamespaces = Object.entries(CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE)
      .filter(([, canonical]) => canonical === COPILOT_CANONICAL_COLLECTOR)
      .map(([namespace]) => namespace)
    expect(copilotNamespaces.length).toBeGreaterThan(0)
    for (const namespace of copilotNamespaces) {
      const authorized = classifyProviderDiscoveryOutcome(COPILOT_CANONICAL_COLLECTOR, { sources: [source(namespace, '/' + namespace + '.jsonl')] })
      expect(authorized).toMatchObject({ status: 'success', complete: true, sourceCount: 1 })

      const nearAlias = classifyProviderDiscoveryOutcome(COPILOT_CANONICAL_COLLECTOR, { sources: [source(namespace + '-alias', '/near-alias.jsonl')] })
      expect(nearAlias).toMatchObject({ status: 'failed', complete: false, sourceCount: 0, diagnostic: { code: 'invalid-source' } })
      expect(nearAlias.sources).toEqual([])
    }
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

  it('returns a bounded timeout outcome for a provider that never resolves', async () => {
    const startedAt = Date.now()
    const outcome = await discoverProviderWithOutcome(
      fakeProvider('hung', async () => await new Promise<SessionSource[]>(() => undefined)),
      undefined,
      20,
    )
    expect(outcome).toMatchObject({
      provider: 'hung',
      status: 'timed-out',
      complete: false,
      sourceCount: 0,
      diagnostic: { code: 'discovery-timeout' },
    })
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('lets healthy freshness providers proceed while another provider is hung', async () => {
    const startedAt = Date.now()
    const result = await discoverAllSessionsForFreshness('all', [
      fakeProvider('hung', async () => await new Promise<SessionSource[]>(() => undefined)),
      fakeProvider('healthy', async () => [source('healthy', '/healthy.jsonl')]),
    ], { providerTimeoutMs: 20 })

    expect(result.sources.map(item => item.path)).toEqual(['/healthy.jsonl'])
    expect(result.outcomes.find(item => item.provider === 'hung')).toMatchObject({
      status: 'timed-out',
      complete: false,
    })
    expect(result.outcomes.find(item => item.provider === 'healthy')).toMatchObject({
      status: 'success',
      complete: true,
    })
    expect(Date.now() - startedAt).toBeLessThan(500)
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
  it('bounds provider discovery at two workers while retaining deterministic order', async () => {
    const started: string[] = []
    const releases: Array<() => void> = []
    let active = 0
    let maximumActive = 0
    const provider = (name: string) => fakeProvider(name, async () => {
      started.push(name)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise<void>(resolve => releases.push(resolve))
      active -= 1
      return [source(name, '/' + name + '.jsonl')]
    })
    const pending = discoverAllSessionsWithOutcomes('all', [provider('zeta'), provider('alpha'), provider('beta'), provider('gamma')])
    await vi.waitFor(() => expect(started).toHaveLength(2))
    expect(maximumActive).toBe(2)
    releases.splice(0, 2).forEach(resolve => resolve())
    await vi.waitFor(() => expect(started).toHaveLength(4))
    releases.splice(0, 2).forEach(resolve => resolve())
    const result = await pending
    expect(maximumActive).toBe(2)
    expect(result.outcomes.map(item => item.provider)).toEqual(['alpha', 'beta', 'gamma', 'zeta'])
    expect(result.sources.map(item => item.path)).toEqual(['/alpha.jsonl', '/beta.jsonl', '/gamma.jsonl', '/zeta.jsonl'])
  })

  it('stops launching providers after cancellation and preserves cancelled outcomes', async () => {
    const started: string[] = []
    const controller = new AbortController()
    let releaseGate!: () => void
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    const provider = (name: string) => fakeProvider(name, async () => {
      started.push(name)
      await gate
      return [source(name, '/' + name + '.jsonl')]
    })
    const pending = discoverAllSessionsWithOutcomes('all', [provider('alpha'), provider('beta'), provider('gamma'), provider('delta')], controller.signal)
    await vi.waitFor(() => expect(started).toHaveLength(2))
    controller.abort()
    const result = await pending
    releaseGate()
    expect(started).toHaveLength(2)
    expect(result.outcomes.every(item => item.status === 'cancelled')).toBe(true)
  })
})
