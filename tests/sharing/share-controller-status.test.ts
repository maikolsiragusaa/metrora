// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShareController } from '../../src/sharing/share-controller.js'
import { getConfigFilePath } from '../../src/config.js'

// Companion v002 renders the paired-device list from ShareStatus.peerList.
// These pins keep that projection real (names + paired dates) and bounded:
// tokens and fingerprints must never reach the UI payload.
describe('ShareController status peer projection', () => {
  let configDir: string

  beforeEach(async () => {
    configDir = join(tmpdir(), `metrora-peer-projection-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    vi.stubEnv('METRORA_CONFIG_DIR', configDir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('projects real paired device names and dates without secrets', async () => {
    const sharingDir = join(configDir, 'sharing')
    await mkdir(sharingDir, { recursive: true })
    await writeFile(join(sharingDir, 'paired-peers.json'), JSON.stringify([
      { fingerprint: 'fp-older', name: 'Pixel 8', token: 'bearer-token-1', pairedAt: 1_000 },
      { fingerprint: 'fp-newer', name: 'Galaxy S25', token: 'bearer-token-2', pairedAt: 2_000 },
    ]))

    const controller = new ShareController(async () => ({}))
    const status = await controller.status()

    expect(status.peers).toBe(2)
    expect(status.peerList).toEqual([
      { name: 'Galaxy S25', pairedAt: 2_000 },
      { name: 'Pixel 8', pairedAt: 1_000 },
    ])

    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('bearer-token')
    expect(serialized).not.toContain('fp-older')
    expect(serialized).not.toContain('fp-newer')
  })

  it('reports an empty list when no device has paired', async () => {
    const controller = new ShareController(async () => ({}))
    const status = await controller.status()
    expect(status.peers).toBe(0)
    expect(status.peerList).toEqual([])
  })

  it('reads the persisted peers file location used by the share server', async () => {
    const sharingDir = join(configDir, 'sharing')
    await mkdir(sharingDir, { recursive: true })
    await writeFile(join(sharingDir, 'paired-peers.json'), JSON.stringify([
      { fingerprint: 'fp-a', name: 'Pixel 8', token: 't', pairedAt: 5 },
    ]))
    expect(getConfigFilePath()).toContain(configDir)
    const controller = new ShareController(async () => ({}))
    const status = await controller.status()
    expect(status.peerList).toEqual([{ name: 'Pixel 8', pairedAt: 5 }])
  })
})
