// @vitest-environment node
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShareController } from '../../src/sharing/share-controller.js'
import { companionPairRequest } from '../../src/sharing/client.js'
import { generateIdentity, type Identity } from '../../src/sharing/identity.js'

// Positive confirmation for approve-flow pairings: success renders only on a
// `paired` outcome for the specific request id. A vanished pending entry also
// vanishes on expiry, decline, or stop, so it can never prove completion.
// These drive the real controller + TLS server + first-party client.
describe('ShareController pairing outcomes', () => {
  let configDir: string
  let clientId: Identity
  const controllers: ShareController[] = []

  beforeEach(async () => {
    configDir = join(tmpdir(), `metrora-pair-outcome-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    vi.stubEnv('METRORA_CONFIG_DIR', configDir)
    clientId = await generateIdentity('Outcome Phone')
  })

  afterEach(async () => {
    for (const controller of controllers.splice(0)) {
      await controller.stop().catch(() => {})
    }
    vi.unstubAllEnvs()
  })

  async function startedController(): Promise<{ controller: ShareController; port: number }> {
    const controller = new ShareController(async () => ({}), 0)
    controllers.push(controller)
    await controller.start(false)
    const status = await controller.status()
    expect(status.sharing).toBe(true)
    return { controller, port: status.port }
  }

  async function pendingId(controller: ShareController): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const id = (await controller.status()).pending[0]?.id
      if (id) return id
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('pairing request never appeared in status')
  }

  function requestPairing(port: number, name: string): Promise<{ status: number; json: unknown }> {
    return companionPairRequest({ identity: clientId, host: '127.0.0.1', port }, name)
  }

  it('reports expired when approving a request that is already gone', async () => {
    const controller = new ShareController(async () => ({}))
    controllers.push(controller)
    await expect(controller.approvePairingRequest('no-such-request', true)).resolves.toBe('expired')
  })

  it('confirms pairing only after the server persists the peer', async () => {
    const { controller, port } = await startedController()
    const requested = requestPairing(port, 'Outcome Phone')
    const id = await pendingId(controller)

    await expect(controller.approvePairingRequest(id, true)).resolves.toBe('paired')

    const response = await requested
    expect(response.status).toBe(200)
    expect((response.json as { token?: unknown }).token).toBeTruthy()
    const status = await controller.status()
    expect(status.peers).toBe(1)
    expect(status.peerList?.[0]?.name).toBe('Outcome Phone')
  }, 30_000)

  it('declines through the outcome without pairing', async () => {
    const { controller, port } = await startedController()
    const requested = requestPairing(port, 'Outcome Phone')
    const id = await pendingId(controller)

    await expect(controller.approvePairingRequest(id, false)).resolves.toBe('declined')

    const response = await requested
    expect(response.status).toBe(403)
    expect((await controller.status()).peers).toBe(0)
  }, 30_000)

  it('reports expired when the service stops before the decision', async () => {
    const { controller, port } = await startedController()
    const requested = requestPairing(port, 'Outcome Phone')
    const id = await pendingId(controller)

    await controller.stop()
    await expect(controller.approvePairingRequest(id, true)).resolves.toBe('expired')

    const response = await requested
    expect(response.status).toBe(403)
  }, 30_000)
})
