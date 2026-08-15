import { describe, expect, it } from 'vitest'

import { SHARE_API_VERSION, canonicalSharePath } from './share-server.js'

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
  })

  it('does not rewrite unrelated or future-version paths', () => {
    expect(canonicalSharePath('/api/v2/usage')).toBe('/api/v2/usage')
    expect(canonicalSharePath('/health')).toBe('/health')
  })

  it('publishes the first stable protocol version', () => {
    expect(SHARE_API_VERSION).toBe(1)
  })
})
