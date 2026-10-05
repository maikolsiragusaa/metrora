// @vitest-environment node
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShareController } from '../../src/sharing/share-controller.js'
import { companionPairRequest } from '../../src/sharing/client.js'
import { generateIdentity, type Identity } from '../../src/sharing/identity.js'

vi.mock('../../src/sharing/store.js', async importOriginal => {
  const mod = await importOriginal<typeof import('../../src/sharing/store.js')>()
  return { ...mod, savePeers: async () => { throw new Error('simulated disk failure') } }
})

// A failed peer save rolls the pairing back server-side: the phone gets an
// error (never a token) and the desktop outcome must be `persist-failed`,
// never success. The store failure is the only seam injected here; the
// controller, TLS server, and first-party client are all real.
describe('ShareController pairing persistence failure', () => {
  let clientId: Identity
  let controller: ShareController | null = null

  beforeEach(async () => {
    vi.stubEnv('METRORA_CONFIG_DIR', join(tmpdir(), `metrora-pair-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`))
    clientId = await generateIdentity('Persist Phone')
  })

  afterEach(async () => {
    await controller?.stop().catch(() => {})
    controller = null
    vi.unstubAllEnvs()
  })

  it('reports persist-failed and rolls the peer back', async () => {
    controller = new ShareController(async () => ({}), 0)
    await controller.start(false)
    const { port } = await controller.status()

    const requested = companionPairRequest({ identity: clientId, host: '127.0.0.1', port }, 'Persist Phone')
    let id = ''
    for (let i = 0; i < 200 && !id; i++) {
      id = (await controller.status()).pending[0]?.id ?? ''
      if (!id) await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(id).toBeTruthy()

    await expect(controller.approvePairingRequest(id, true)).resolves.toBe('persist-failed')

    const response = await requested
    expect(response.status).toBe(500)
    const status = await controller.status()
    expect(status.peers).toBe(0)
    expect(status.peerList ?? []).toEqual([])
  }, 30_000)
})
