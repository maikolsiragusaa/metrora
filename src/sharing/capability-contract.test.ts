import { describe, expect, it } from 'vitest'

import {
  buildCompanionCapabilitiesV1,
  isCompanionCapabilitiesV1,
  negotiateCapabilityVersion,
} from './capability-contract.js'

describe('Companion capability discovery', () => {
  it('advertises bounded domains and keeps Workspace explicitly unavailable', () => {
    const discovery = buildCompanionCapabilitiesV1('2026-08-14T10:00:00.000Z')

    expect(isCompanionCapabilitiesV1(discovery)).toBe(true)
    expect(negotiateCapabilityVersion(discovery, 'projects')).toBe(1)
    expect(negotiateCapabilityVersion(discovery, 'workspace')).toBeNull()
    expect(discovery.capabilities).toHaveLength(7)
    expect(new Set(discovery.capabilities.map(capability => capability.freshness))).toEqual(new Set(['unknown']))
  })

  it('negotiates only versions the client actually supports', () => {
    const discovery = buildCompanionCapabilitiesV1()

    expect(negotiateCapabilityVersion(discovery, 'home.usage', [2])).toBeNull()
    expect(negotiateCapabilityVersion(discovery, 'home.usage', [1, 2])).toBe(1)
  })

  it('rejects foreign or malformed discovery envelopes without a false positive', () => {
    expect(isCompanionCapabilitiesV1({ kind: 'metrora.companion.capabilities', version: 2, capabilities: [] })).toBe(false)
    expect(isCompanionCapabilitiesV1({ kind: 'metrora.companion.capabilities', version: 1, capabilities: 'not-an-array' })).toBe(false)
  })
})
