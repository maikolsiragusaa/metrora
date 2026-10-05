// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createShareBridgeHandlers } from './share-bridge'
import type { DesktopCompanionCapabilities, DesktopShareStatus } from './share-runtime'

const status: DesktopShareStatus = {
  sharing: true,
  name: 'Metrora Desktop',
  port: 7777,
  host: '192.168.1.10',
  addresses: ['192.168.1.10'],
  connectPayload: 'metrora://pair',
  always: false,
  peers: 2,
  pending: [],
}

function capabilitiesPayload(capacityAvailable: boolean): DesktopCompanionCapabilities {
  const available = new Set([
    'home.usage',
    'projects',
    'activity.sessions',
    'activity.pullRequests',
    'analyze.models',
    'analyze.spend',
    'device.settings',
  ])
  if (capacityAvailable) available.add('home.capacity')
  const ids = [
    'home.usage',
    'home.capacity',
    'projects',
    'activity.sessions',
    'activity.pullRequests',
    'analyze.models',
    'analyze.spend',
    'workspace',
    'device.settings',
  ]
  return {
    kind: 'metrora.companion.capabilities',
    version: 1,
    generatedAt: '2026-09-21T00:00:00.000Z',
    capabilities: ids.map(id => ({
      id,
      versions: [1],
      availability: available.has(id) ? 'available' : 'unavailable',
      freshness: 'unknown',
      scopes: { period: true, project: true, workspace: false },
      ...(id === 'workspace' ? { reason: 'no-authority' as const } : {}),
    })),
  }
}

describe('companion capability bridge', () => {
  it('returns the canonical CompanionCapabilitiesV1 through the trusted runtime', async () => {
    const capabilities = vi.fn(async () => capabilitiesPayload(true))
    const share = { status: async () => status, start: async () => status, stop: async () => status, approve: async () => ({ status, outcome: 'paired' as const }), capabilities }
    const handlers = createShareBridgeHandlers(share)

    const result = await handlers['metrora:getCompanionCapabilities']!()
    expect(result).toEqual({ ok: true, value: capabilitiesPayload(true) })
    expect(capabilities).toHaveBeenCalledTimes(1)
  })

  it('is read-only and never starts, stops, or approves pairing', async () => {
    const start = vi.fn()
    const stop = vi.fn()
    const approve = vi.fn()
    const capabilities = vi.fn(async () => capabilitiesPayload(false))
    const share = { status: async () => status, start, stop, approve, capabilities }
    const handlers = createShareBridgeHandlers(share)

    await handlers['metrora:getCompanionCapabilities']!()
    expect(start).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  it('preserves canonical capacity and workspace authority', async () => {
    const withCapacity = createShareBridgeHandlers({
      status: async () => status,
      start: async () => status,
      stop: async () => status,
      approve: async () => ({ status, outcome: 'paired' as const }),
      capabilities: async () => capabilitiesPayload(true),
    })
    const withResult = (await withCapacity['metrora:getCompanionCapabilities']!()) as { ok: true; value: DesktopCompanionCapabilities }
    expect(withResult.value.capabilities.find(entry => entry.id === 'home.capacity')?.availability).toBe('available')

    const withoutCapacity = createShareBridgeHandlers({
      status: async () => status,
      start: async () => status,
      stop: async () => status,
      approve: async () => ({ status, outcome: 'paired' as const }),
      capabilities: async () => capabilitiesPayload(false),
    })
    const withoutResult = (await withoutCapacity['metrora:getCompanionCapabilities']!()) as { ok: true; value: DesktopCompanionCapabilities }
    expect(withoutResult.value.capabilities.find(entry => entry.id === 'home.capacity')?.availability).toBe('unavailable')

    for (const result of [withResult, withoutResult]) {
      const workspace = result.value.capabilities.find(entry => entry.id === 'workspace')
      expect(workspace?.availability).toBe('unavailable')
      expect(workspace?.reason).toBe('no-authority')
    }
  })

  it('exposes no secrets, tokens, or private pairing material', async () => {
    const handlers = createShareBridgeHandlers({
      status: async () => status,
      start: async () => status,
      stop: async () => status,
      approve: async () => ({ status, outcome: 'paired' as const }),
      capabilities: async () => capabilitiesPayload(true),
    })
    const result = await handlers['metrora:getCompanionCapabilities']!()
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/token|fingerprint|secret|private|prompt|response|patch|bearer|certificate/i)
  })

  it('returns a bounded unavailable envelope when the runtime is missing', async () => {
    for (const share of [null, undefined]) {
      const handlers = createShareBridgeHandlers(share)
      const result = await handlers['metrora:getCompanionCapabilities']!()
      expect(result).toEqual({ ok: false, error: { kind: 'nonzero', message: 'Desktop sharing is unavailable.' } })
    }
  })

  it('sanitizes unexpected runtime failures without leaking details', async () => {
    const handlers = createShareBridgeHandlers({
      status: async () => status,
      start: async () => status,
      stop: async () => status,
      approve: async () => ({ status, outcome: 'paired' as const }),
      capabilities: async () => { throw new Error('Bearer sk-ant-secret material') },
    })
    const result = await handlers['metrora:getCompanionCapabilities']!()
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).not.toMatch(/sk-ant-secret/)
  })
})
