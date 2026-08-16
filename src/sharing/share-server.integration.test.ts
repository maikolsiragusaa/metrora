import { describe, expect, it } from 'vitest'

import {
  companionHello,
  fetchCompanionCapabilities,
  fetchCompanionFoundation,
  companionPairRequest,
  fetchCompanionUsage,
  fetchUsage,
  fetchCompanionProjectCatalog,
  revokeCompanion,
} from './client.js'
import { generateIdentity } from './identity.js'
import { pairingCode, PeerStore } from './pairing.js'
import { ShareServer, type PairRequest } from './share-server.js'

describe('secure companion lifecycle', () => {
  it('locks the cross-platform six-digit SAS derivation', () => {
    expect(pairingCode('00'.repeat(32), 'ff'.repeat(32))).toBe('404542')
    expect(pairingCode('ff'.repeat(32), '00'.repeat(32))).toBe('404542')
  })

  it('exposes the matching SAS before Desktop approval resolves or a peer is saved', async () => {
    const desktop = await generateIdentity('Metrora desktop')
    const phone = await generateIdentity('Android phone')
    const peers = new PeerStore()
    let request: PairRequest | null = null
    let resolveApproval: ((approved: boolean) => void) | undefined
    const approval = new Promise<boolean>((resolve) => { resolveApproval = resolve })
    const server = new ShareServer({
      identity: desktop,
      peers,
      getUsage: async () => ({ generated: new Date().toISOString(), current: {} }),
      approve: async (candidate) => {
        request = candidate
        return approval
      },
    })

    const port = await server.listen(0, '127.0.0.1')
    try {
      const pairing = companionPairRequest(
        { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint },
        'Android phone',
      )
      for (let attempt = 0; attempt < 100 && request === null; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      expect(request).toMatchObject({
        name: 'Android phone',
        fingerprint: phone.fingerprint,
        code: pairingCode(desktop.fingerprint, phone.fingerprint),
      })
      expect(peers.list()).toHaveLength(0)

      resolveApproval?.(true)
      const paired = await pairing
      expect(paired.status).toBe(200)
      expect(peers.list()).toHaveLength(1)
    } finally {
      resolveApproval?.(false)
      await server.close()
    }
  }, 30_000)

  it('compares identities, binds the token to mTLS, serves v1 DTOs and revokes access', async () => {
    const desktop = await generateIdentity('Metrora desktop')
    const phone = await generateIdentity('Android phone')
    const attacker = await generateIdentity('Other device')
    const peers = new PeerStore()
    let approval: PairRequest | null = null
    let peerChanges = 0
    const internalPayload = {
      generated: '2026-07-31T10:30:00.000Z',
      current: {
        label: 'This month',
        cost: 0.75,
        calls: 5,
        sessions: 2,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
        cacheHitPercent: 16.7,
        pricingCoverage: 1,
        topModels: [{ name: 'Model A', calls: 5, cost: 0.75 }],
        topProjects: [{ name: 'must-not-leak' }],
      },
    }
    const server = new ShareServer({
      identity: desktop,
      peers,
      getUsage: async () => internalPayload,
      getCapabilities: async () => ({ kind: 'metrora.companion.capabilities', version: 1, capabilities: [] }),
      getFoundation: async (query) => ({ kind: 'metrora.companion.foundation', version: 1, projectScopeId: query.projectScopeId ?? 'all' }),
      getProjectCatalog: async () => ({
        kind: 'metrora.companion.projects',
        version: 1,
        generatedAt: '2026-07-31T10:30:00.000Z',
        available: true,
        projectScope: {
          selectedId: 'all',
          options: [{ id: 'all', name: 'All projects', icon: 'grid', color: 'cyan', sourceProjectCount: 3 }],
          sourceProjects: [],
          registry: { status: 'valid', writable: true },
        },
      }),
      onPeersChanged: () => {
        peerChanges += 1
      },
      approve: async (request) => {
        approval = request
        return true
      },
    })

    const port = await server.listen(0, '127.0.0.1')
    try {
      const discovered = await companionHello({ identity: phone, host: '127.0.0.1', port })
      expect(discovered.status).toBe(200)
      expect(discovered.serverFingerprint).toBe(desktop.fingerprint)
      expect(discovered.json).toMatchObject({
        product: 'metrora',
        apiVersion: 1,
        pairingMethods: ['approve-sas'],
      })

      const expectedCode = pairingCode(desktop.fingerprint, phone.fingerprint)
      expect(expectedCode).toMatch(/^\d{6}$/)
      const paired = await companionPairRequest(
        { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint },
        'Android phone',
      )
      expect(paired.status).toBe(200)
      expect(paired.json).toMatchObject({ code: expectedCode, fingerprint: desktop.fingerprint })
      expect(approval).toMatchObject({ name: 'Android phone', fingerprint: phone.fingerprint, code: expectedCode })
      expect(peers.list()).toHaveLength(1)
      expect(peerChanges).toBe(1)

      const token = (paired.json as { token: string }).token
      const endpoint = { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint }
      const usage = await fetchCompanionUsage(endpoint, token, { period: 'month' })
      expect(usage.status).toBe(200)
      expect(usage.json).toMatchObject({
        kind: 'metrora.companion.usage',
        version: 1,
        totals: { costMicrosUsd: 750_000, calls: 5, sessions: 2 },
      })
      expect(JSON.stringify(usage.json)).not.toContain('must-not-leak')

      const capabilities = await fetchCompanionCapabilities(endpoint, token)
      expect(capabilities.status).toBe(200)
      expect(capabilities.json).toMatchObject({ kind: 'metrora.companion.capabilities', version: 1 })

      const foundation = await fetchCompanionFoundation(endpoint, token, { period: 'month', projectScopeId: 'mp_demo' })
      expect(foundation.status).toBe(200)
      expect(foundation.json).toMatchObject({ kind: 'metrora.companion.foundation', version: 1, projectScopeId: 'mp_demo' })

      const catalog = await fetchCompanionProjectCatalog(endpoint, token)
      expect(catalog.status).toBe(200)
      expect(catalog.json).toMatchObject({
        kind: 'metrora.companion.projects',
        version: 1,
        desktopId: desktop.fingerprint,
        projectScope: { options: [{ id: 'all', sourceProjectCount: 3 }] },
      })

      // The inherited desktop route remains compatible and intentionally keeps
      // the legacy payload until desktop-to-desktop migration is explicit.
      const legacy = await fetchUsage(endpoint, token, { period: 'month' })
      expect(legacy.status).toBe(200)
      expect(legacy.json).toEqual(internalPayload)

      // A stolen bearer token is insufficient without the paired private key.
      const replay = await fetchCompanionUsage(
        { identity: attacker, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint },
        token,
      )
      expect(replay.status).toBe(401)

      const revoked = await revokeCompanion(endpoint, token)
      expect(revoked.status).toBe(200)
      expect(revoked.json).toEqual({ revoked: true })
      expect(peers.list()).toHaveLength(0)
      expect(peerChanges).toBe(2)

      const afterRevoke = await fetchCompanionUsage(endpoint, token)
      expect(afterRevoke.status).toBe(401)
    } finally {
      await server.close()
    }
  }, 30_000)

  it('passes the same period, bounds, granularity and Project scope to Usage and Foundation', async () => {
    const desktop = await generateIdentity('Metrora desktop')
    const phone = await generateIdentity('Android phone')
    const peers = new PeerStore()
    const usageQueries: unknown[] = []
    const foundationQueries: unknown[] = []
    const server = new ShareServer({
      identity: desktop,
      peers,
      getUsage: async (query) => {
        usageQueries.push(query)
        return {
          generated: '2026-08-15T10:30:00.000Z',
          current: { label: 'Last 6 months', topModels: [] },
          history: { periodDaily: [] },
        }
      },
      getFoundation: async (query) => {
        foundationQueries.push(query)
        return { kind: 'metrora.companion.foundation', version: 1, projectScopeId: query.projectScopeId }
      },
      approve: async () => true,
    })

    const port = await server.listen(0, '127.0.0.1')
    try {
      const paired = await companionPairRequest(
        { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint },
        'Android phone',
      )
      const token = (paired.json as { token: string }).token
      const endpoint = { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint }

      await fetchCompanionUsage(endpoint, token, {
        period: 'lifetime',
        granularity: 'week',
        projectScopeId: 'mp_fixture',
      })
      await fetchCompanionFoundation(endpoint, token, {
        period: 'lifetime',
        granularity: 'week',
        projectScopeId: 'mp_fixture',
      })

      expect(usageQueries).toHaveLength(1)
      expect(foundationQueries).toHaveLength(1)
      expect(usageQueries[0]).toEqual(foundationQueries[0])
      expect(usageQueries[0]).toMatchObject({
        period: 'lifetime',
        granularity: 'week',
        projectScopeId: 'mp_fixture',
        effectiveFrom: '1970-01-01',
      })
      expect(usageQueries[0]).toHaveProperty('effectiveTo')

      const defaultCases = [
        { period: 'today', expectedGranularity: 'day' },
        { period: 'week', expectedGranularity: 'day' },
        { period: '30days', expectedGranularity: 'day' },
        { period: 'month', expectedGranularity: 'day' },
        { period: 'all', expectedGranularity: 'week' },
        { period: 'lifetime', expectedGranularity: 'month' },
      ]
      for (const projectScopeId of ['all', 'unassigned', 'mp_fixture']) {
        for (const testCase of defaultCases) {
          const query = { period: testCase.period, projectScopeId }
          await fetchCompanionUsage(endpoint, token, query)
          await fetchCompanionFoundation(endpoint, token, query)
          const usageQuery = usageQueries.at(-1)
          const foundationQuery = foundationQueries.at(-1)
          expect(usageQuery).toEqual(foundationQuery)
          expect(usageQuery).toMatchObject({
            period: testCase.period,
            granularity: testCase.expectedGranularity,
            projectScopeId,
          })
          expect(usageQuery).toHaveProperty('effectiveFrom')
          expect(usageQuery).toHaveProperty('effectiveTo')
        }
      }

      const explicitCases = [
        { period: 'today', granularity: 'day' },
        { period: 'week', granularity: 'week' },
        { period: 'month', granularity: 'month' },
      ]
      for (const query of explicitCases) {
        await fetchCompanionUsage(endpoint, token, { ...query, projectScopeId: 'mp_fixture' })
        await fetchCompanionFoundation(endpoint, token, { ...query, projectScopeId: 'mp_fixture' })
        expect(usageQueries.at(-1)).toEqual(foundationQueries.at(-1))
        expect(usageQueries.at(-1)).toMatchObject({ ...query, projectScopeId: 'mp_fixture' })
      }

      const customBounds = {
        from: '2025-01-01',
        to: '2026-08-15',
        projectScopeId: 'mp_fixture',
      }
      await fetchCompanionUsage(endpoint, token, customBounds)
      await fetchCompanionFoundation(endpoint, token, customBounds)
      expect(usageQueries.at(-1)).toEqual(foundationQueries.at(-1))
      expect(usageQueries.at(-1)).toMatchObject({
        ...customBounds,
        period: 'month',
        granularity: 'month',
        effectiveFrom: customBounds.from,
        effectiveTo: customBounds.to,
      })
    } finally {
      await server.close()
    }
  }, 30_000)

  it('keeps the paired canonical state across a ShareServer restart', async () => {
    const desktop = await generateIdentity('Metrora desktop')
    const phone = await generateIdentity('Android phone')
    const peers = new PeerStore()
    const catalog = {
      kind: 'metrora.companion.projects',
      version: 1,
      generatedAt: '2026-08-15T10:30:00.000Z',
      available: true,
      projectScope: {
        selectedId: 'all',
        options: [{ id: 'all', name: 'All projects', icon: 'grid', color: 'cyan', sourceProjectCount: 3 }],
        sourceProjects: [],
        registry: { status: 'valid', writable: true },
      },
    }
    const createServer = () => new ShareServer({
      identity: desktop,
      peers,
      getUsage: async (query) => ({
        generated: '2026-08-15T10:30:00.000Z',
        current: { label: query.period ?? 'month', topModels: [] },
        history: { periodDaily: [] },
      }),
      getFoundation: async (query) => ({
        kind: 'metrora.companion.foundation',
        version: 1,
        projectScopeId: query.projectScopeId ?? 'all',
        trendGranularity: query.granularity,
      }),
      getProjectCatalog: async () => catalog,
      approve: async () => true,
    })

    let server = createServer()
    let port = await server.listen(0, '127.0.0.1')
    try {
      const paired = await companionPairRequest(
        { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint },
        'Android phone',
      )
      expect(paired.status).toBe(200)
      const token = (paired.json as { token: string }).token
      await server.close()

      // Recreate the real HTTPS lifecycle with the same Desktop identity and
      // durable peer store. The phone must reconnect without a new pairing.
      server = createServer()
      port = await server.listen(0, '127.0.0.1')
      const endpoint = { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint }
      const usage = await fetchCompanionUsage(endpoint, token, {
        period: 'lifetime',
        projectScopeId: 'mp_fixture',
      })
      const foundation = await fetchCompanionFoundation(endpoint, token, {
        period: 'lifetime',
        projectScopeId: 'mp_fixture',
      })
      const projects = await fetchCompanionProjectCatalog(endpoint, token)

      expect(usage.status).toBe(200)
      expect(foundation.status).toBe(200)
      expect(projects.status).toBe(200)
      // Usage/Foundation bind the Desktop identity through the mTLS peer and
      // the Android parsers bind the resulting snapshots to the paired
      // credentials. The catalog additionally carries the explicit identity.
      expect(usage.json).toMatchObject({ kind: 'metrora.companion.usage' })
      expect(foundation.json).toMatchObject({
        kind: 'metrora.companion.foundation',
        projectScopeId: 'mp_fixture',
        trendGranularity: 'month',
      })
      expect(projects.json).toMatchObject({
        kind: 'metrora.companion.projects',
        desktopId: desktop.fingerprint,
        projectScope: { options: [{ id: 'all', sourceProjectCount: 3 }] },
      })
    } finally {
      await server.close()
    }
  }, 30_000)

  it('rolls peer state back when durable persistence fails', async () => {
    const desktop = await generateIdentity('Metrora desktop')
    const phone = await generateIdentity('Existing phone')
    const candidate = await generateIdentity('New phone')
    const peers = new PeerStore()
    const existing = peers.pair(phone.fingerprint, 'Existing phone')
    const server = new ShareServer({
      identity: desktop,
      peers,
      getUsage: async () => ({ generated: new Date().toISOString(), current: {} }),
      onPeersChanged: async () => {
        throw new Error('simulated persistence failure')
      },
      approve: async () => true,
    })

    const port = await server.listen(0, '127.0.0.1')
    try {
      const failedPair = await companionPairRequest(
        { identity: candidate, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint },
        'New phone',
      )
      expect(failedPair.status).toBe(500)
      expect(failedPair.json).toEqual({ error: 'simulated persistence failure' })
      expect(peers.get(candidate.fingerprint)).toBeUndefined()
      expect(peers.authorize(existing.token, phone.fingerprint)).toBe(true)

      const failedRevoke = await revokeCompanion(
        { identity: phone, host: '127.0.0.1', port, expectedFingerprint: desktop.fingerprint },
        existing.token,
      )
      expect(failedRevoke.status).toBe(500)
      expect(failedRevoke.json).toEqual({ error: 'simulated persistence failure' })
      expect(peers.authorize(existing.token, phone.fingerprint)).toBe(true)
    } finally {
      await server.close()
    }
  }, 30_000)
})
