import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EndpointIdentityRecoveryRequiredError,
  loadOrCreateLocalEndpointIdentityV1,
  rotateLocalEndpointIdentityV1,
  signWithLocalEndpointIdentityV1,
  verifyLocalEndpointIdentitySignatureV1,
} from './endpoint-identity.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'qovrion-endpoint-identity-'))
  roots.push(value)
  return value
}

function protector(byte = 7): Aes256GcmSecretProtector {
  return new Aes256GcmSecretProtector(Buffer.alloc(32, byte))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('local endpoint identity v1', () => {
  it('creates one encrypted identity and loads it idempotently', async () => {
    const dataDir = await root()
    const options = {
      dataDir,
      protector: protector(),
      now: () => new Date('2026-07-31T14:00:00.000Z'),
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      randomBytes: (size: number) => Buffer.alloc(size, 9),
    }

    const first = await loadOrCreateLocalEndpointIdentityV1(options)
    const second = await loadOrCreateLocalEndpointIdentityV1(options)
    expect(second.metadata).toEqual(first.metadata)
    expect(Buffer.from(second.privateKeyPkcs8)).toEqual(Buffer.from(first.privateKeyPkcs8))
    expect(Buffer.from(second.eventIdentityKey)).toEqual(Buffer.alloc(32, 9))
    expect(first.metadata).toMatchObject({
      endpointId: 'ep_11111111-2222-4333-8444-555555555555',
      generation: 1,
      eventIdentityKeyVersion: 1,
      keyAlgorithm: 'ed25519',
    })

    const metadataPath = join(dataDir, 'identity', 'endpoint-identity.v1.json')
    const secretPath = join(dataDir, 'identity', 'endpoint-identity.v1.secret')
    const metadataText = await readFile(metadataPath, 'utf-8')
    const sealedText = await readFile(secretPath, 'utf-8')
    expect(metadataText).not.toContain('privateKeyPkcs8Base64')
    expect(metadataText).not.toContain('eventIdentityKeyBase64')
    expect(sealedText).not.toContain('privateKeyPkcs8Base64')
    expect(sealedText).not.toContain('eventIdentityKeyBase64')
  })

  it('repairs missing public metadata from the protected secret', async () => {
    const dataDir = await root()
    const options = { dataDir, protector: protector() }
    const first = await loadOrCreateLocalEndpointIdentityV1(options)
    await unlink(join(dataDir, 'identity', 'endpoint-identity.v1.json'))

    const repaired = await loadOrCreateLocalEndpointIdentityV1(options)
    expect(repaired.metadata).toEqual(first.metadata)
    expect(JSON.parse(await readFile(join(dataDir, 'identity', 'endpoint-identity.v1.json'), 'utf-8')))
      .toEqual(first.metadata)
  })

  it('fails closed when metadata survives but the protected secret is missing', async () => {
    const dataDir = await root()
    const options = { dataDir, protector: protector() }
    await loadOrCreateLocalEndpointIdentityV1(options)
    await unlink(join(dataDir, 'identity', 'endpoint-identity.v1.secret'))

    await expect(loadOrCreateLocalEndpointIdentityV1(options)).rejects.toBeInstanceOf(
      EndpointIdentityRecoveryRequiredError,
    )
  })

  it('rejects a wrong master key instead of replacing the endpoint', async () => {
    const dataDir = await root()
    const first = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector: protector(1) })
    await expect(loadOrCreateLocalEndpointIdentityV1({ dataDir, protector: protector(2) }))
      .rejects.toThrow(/could not be decrypted/)
    const restored = await loadOrCreateLocalEndpointIdentityV1({ dataDir, protector: protector(1) })
    expect(restored.metadata.endpointId).toBe(first.metadata.endpointId)
  })

  it('rotates key material while preserving endpoint identity and signing validity', async () => {
    const dataDir = await root()
    const times = [
      new Date('2026-07-31T14:00:00.000Z'),
      new Date('2026-07-31T15:00:00.000Z'),
    ]
    let index = 0
    const options = {
      dataDir,
      protector: protector(),
      now: () => times[Math.min(index++, times.length - 1)]!,
    }
    const first = await loadOrCreateLocalEndpointIdentityV1(options)
    const rotated = await rotateLocalEndpointIdentityV1(options)

    expect(rotated.metadata.endpointId).toBe(first.metadata.endpointId)
    expect(rotated.metadata.generation).toBe(2)
    expect(rotated.metadata.eventIdentityKeyVersion).toBe(2)
    expect(rotated.metadata.createdAt).toBe(first.metadata.createdAt)
    expect(rotated.metadata.rotatedAt).toBe('2026-07-31T15:00:00.000Z')
    expect(rotated.metadata.publicKeyFingerprintSha256).not.toBe(first.metadata.publicKeyFingerprintSha256)
    expect(Buffer.from(rotated.eventIdentityKey)).not.toEqual(Buffer.from(first.eventIdentityKey))

    const payload = Buffer.from('qovrion endpoint proof')
    const signature = signWithLocalEndpointIdentityV1(rotated, payload)
    expect(verifyLocalEndpointIdentitySignatureV1(rotated.metadata, payload, signature)).toBe(true)
    expect(verifyLocalEndpointIdentitySignatureV1(first.metadata, payload, signature)).toBe(false)
  })
})
