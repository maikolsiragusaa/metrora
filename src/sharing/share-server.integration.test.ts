import { describe, expect, it } from 'vitest'

import {
  companionHello,
  companionPairRequest,
  fetchCompanionUsage,
  fetchUsage,
  revokeCompanion,
} from './client.js'
import { generateIdentity } from './identity.js'
import { pairingCode, PeerStore } from './pairing.js'
import { ShareServer, type PairRequest } from './share-server.js'

describe('secure companion lifecycle', () => {
  it('compares identities, binds the token to mTLS, serves v1 DTOs and revokes access', async () => {
    const desktop = await generateIdentity('Qovrion desktop')
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
        product: 'qovrion',
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
        kind: 'qovrion.companion.usage',
        version: 1,
        totals: { costMicrosUsd: 750_000, calls: 5, sessions: 2 },
      })
      expect(JSON.stringify(usage.json)).not.toContain('must-not-leak')

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
})
