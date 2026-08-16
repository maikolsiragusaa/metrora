import { describe, expect, it } from 'vitest'

import { SHARE_API_VERSION, canonicalActivityQuery, canonicalCompanionQuery, canonicalSharePath } from './share-server.js'

describe('Metrora sharing API version compatibility', () => {
  it('keeps inherited unversioned routes unchanged', () => {
    expect(canonicalSharePath('/api/peer/hello')).toBe('/api/peer/hello')
    expect(canonicalSharePath('/api/peer/pair')).toBe('/api/peer/pair')
    expect(canonicalSharePath('/api/usage')).toBe('/api/usage')
  })

  it('maps stable v1 routes to the corresponding handlers', () => {
    expect(canonicalSharePath('/api/v1/peer/hello')).toBe('/api/peer/hello')
    expect(canonicalSharePath('/api/v1/peer/pair')).toBe('/api/peer/pair')
    expect(canonicalSharePath('/api/v1/peer/pair-request')).toBe('/api/peer/pair-request')
    expect(canonicalSharePath('/api/v1/peer/revoke')).toBe('/api/peer/revoke')
    expect(canonicalSharePath('/api/v1/usage')).toBe('/api/usage')
    expect(canonicalSharePath('/api/v1/capabilities')).toBe('/api/capabilities')
    expect(canonicalSharePath('/api/v1/foundation')).toBe('/api/foundation')
    expect(canonicalSharePath('/api/v1/projects')).toBe('/api/projects')
    expect(canonicalSharePath('/api/v1/activity/sessions')).toBe('/api/activity/sessions')
    expect(canonicalSharePath('/api/v1/activity/pull-requests')).toBe('/api/activity/pull-requests')
  })

  it('does not rewrite unrelated or future-version paths', () => {
    expect(canonicalSharePath('/api/v2/usage')).toBe('/api/v2/usage')
    expect(canonicalSharePath('/health')).toBe('/health')
  })

  it('publishes the first stable protocol version', () => {
    expect(SHARE_API_VERSION).toBe(1)
  })

  it('resolves one effective period range and trend dimension at the authority boundary', () => {
    expect(canonicalCompanionQuery({ period: 'lifetime', projectScopeId: 'mp_fixture' })).toMatchObject({
      period: 'lifetime',
      effectiveFrom: '1970-01-01',
      granularity: 'month',
      projectScopeId: 'mp_fixture',
    })
    const all = canonicalCompanionQuery({ period: 'all' })
    expect(all).toMatchObject({ period: 'all', granularity: 'week', projectScopeId: 'all' })
    expect(all.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(all.effectiveTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('canonicalizes bounded Activity filters and page identity', () => {
    expect(canonicalActivityQuery({
      period: 'month',
      projectScopeId: 'mp_fixture',
      provider: 'claude',
      route: 'anthropic-api',
      model: 'claude-opus-4-6',
      source: 'claude-cli',
      order: 'cost',
      limit: '25',
    })).toMatchObject({
      period: 'month',
      projectScopeId: 'mp_fixture',
      effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      effectiveTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      order: 'cost',
      limit: 25,
    })
  })
})
