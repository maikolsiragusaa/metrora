import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DESKTOP_MASTER_KEY_KIND,
  DesktopEncryptedStateUnreadableError,
  DesktopLocalStateCorruptError,
  DesktopVaultUnavailableError,
  initializeDesktopLocalStateV1,
  type DesktopSafeStorageProvider,
} from './desktop-host.js'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-desktop-vault-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

class FakeSafeStorage implements DesktopSafeStorageProvider {
  available = true
  shouldReEncrypt = false
  encryptions = 0
  decryptions = 0
  readonly prefix: string

  constructor(prefix = 'vault-a') {
    this.prefix = prefix
  }

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async encryptString(plaintext: string): Promise<Uint8Array> {
    this.encryptions += 1
    return Buffer.from(`${this.prefix}:${plaintext}`, 'utf-8')
  }

  async decryptString(ciphertext: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }> {
    this.decryptions += 1
    const value = Buffer.from(ciphertext).toString('utf-8')
    const prefix = `${this.prefix}:`
    if (!value.startsWith(prefix)) throw new Error('wrong OS vault')
    return { result: value.slice(prefix.length), shouldReEncrypt: this.shouldReEncrypt }
  }
}

describe.sequential('desktop OS vault local-state bridge', () => {
  it('creates one OS-wrapped master key and stable endpoint identity', async () => {
    const dataDir = await root()
    const vault = new FakeSafeStorage()
    const options = {
      dataDir,
      backend: 'windows-dpapi' as const,
      safeStorage: vault,
      now: () => new Date('2026-07-31T16:00:00.000Z'),
      randomBytes: (size: number) => Buffer.alloc(size, 17),
    }

    const first = await initializeDesktopLocalStateV1(options)
    const second = await initializeDesktopLocalStateV1(options)
    expect(first.masterKeyState).toBe('created')
    expect(second.masterKeyState).toBe('loaded')
    expect(second.endpoint).toEqual(first.endpoint)
    expect(vault.encryptions).toBe(1)
    expect(vault.decryptions).toBe(1)

    const masterFile = await readFile(
      join(dataDir, 'host-secrets', 'desktop-master-key.v1.json'),
      'utf-8',
    )
    const identitySecret = await readFile(
      join(dataDir, 'identity', 'endpoint-identity.v1.secret'),
      'utf-8',
    )
    expect(masterFile).not.toContain(Buffer.alloc(32, 17).toString('base64'))
    expect(identitySecret).not.toContain('privateKeyPkcs8Base64')
    expect(identitySecret).not.toContain('eventIdentityKeyBase64')
  })

  it('serializes concurrent desktop initialization', async () => {
    const dataDir = await root()
    const vault = new FakeSafeStorage()
    const results = await Promise.all(Array.from({ length: 8 }, () => initializeDesktopLocalStateV1({
      dataDir,
      backend: 'windows-dpapi',
      safeStorage: vault,
    })))
    expect(new Set(results.map(result => result.endpoint.endpointId)).size).toBe(1)
    expect(vault.encryptions).toBe(1)
  })

  it('rewraps ciphertext when the OS provider requests key rotation', async () => {
    const dataDir = await root()
    const vault = new FakeSafeStorage()
    await initializeDesktopLocalStateV1({ dataDir, backend: 'windows-dpapi', safeStorage: vault })
    vault.shouldReEncrypt = true
    const result = await initializeDesktopLocalStateV1({ dataDir, backend: 'windows-dpapi', safeStorage: vault })
    expect(result.masterKeyState).toBe('rewrapped')
    expect(vault.encryptions).toBe(2)
    expect(vault.decryptions).toBe(1)
  })

  it('loads and migrates the pre-Metrora envelope kind without changing identity', async () => {
    const dataDir = await root()
    const vault = new FakeSafeStorage()
    const options = {
      dataDir,
      backend: 'windows-dpapi' as const,
      safeStorage: vault,
      randomBytes: (size: number) => Buffer.alloc(size, 17),
    }
    const first = await initializeDesktopLocalStateV1(options)
    const masterPath = join(dataDir, 'host-secrets', 'desktop-master-key.v1.json')
    const legacyEnvelope = JSON.parse(await readFile(masterPath, 'utf8')) as { kind: string }
    legacyEnvelope.kind = 'qovrion.desktop-master-key'
    await writeFile(masterPath, JSON.stringify(legacyEnvelope))

    const second = await initializeDesktopLocalStateV1(options)
    const migrated = JSON.parse(await readFile(masterPath, 'utf8')) as { kind: string }
    expect(second.masterKeyState).toBe('loaded')
    expect(second.endpoint).toEqual(first.endpoint)
    expect(migrated.kind).toBe(DESKTOP_MASTER_KEY_KIND)
    expect(vault.decryptions).toBe(1)
    expect(vault.encryptions).toBe(1)
  })

  it('classifies corrupt and unreadable existing encrypted state without replacing it', async () => {
    const dataDir = await root()
    const first = new FakeSafeStorage('first')
    await initializeDesktopLocalStateV1({ dataDir, backend: 'windows-dpapi', safeStorage: first })
    const masterPath = join(dataDir, 'host-secrets', 'desktop-master-key.v1.json')
    const originalEnvelope = await readFile(masterPath, 'utf8')
    const corruptEnvelope = JSON.parse(originalEnvelope) as { kind: string }
    corruptEnvelope.kind = 'unexpected.desktop-master-key'
    const corruptEnvelopeSerialized = JSON.stringify(corruptEnvelope)
    await writeFile(masterPath, corruptEnvelopeSerialized)

    await expect(initializeDesktopLocalStateV1({
      dataDir,
      backend: 'windows-dpapi',
      safeStorage: first,
    })).rejects.toBeInstanceOf(DesktopLocalStateCorruptError)
    expect(await readFile(masterPath, 'utf8')).toBe(corruptEnvelopeSerialized)

    await writeFile(masterPath, originalEnvelope)
    await expect(initializeDesktopLocalStateV1({
      dataDir,
      backend: 'windows-dpapi',
      safeStorage: new FakeSafeStorage('second'),
    })).rejects.toBeInstanceOf(DesktopEncryptedStateUnreadableError)
    expect(await readFile(masterPath, 'utf8')).toBe(originalEnvelope)
  })

  it('fails closed for unavailable, wrong or mismatched vaults', async () => {
    const dataDir = await root()
    const unavailable = new FakeSafeStorage()
    unavailable.available = false
    await expect(initializeDesktopLocalStateV1({
      dataDir,
      backend: 'windows-dpapi',
      safeStorage: unavailable,
    })).rejects.toBeInstanceOf(DesktopVaultUnavailableError)

    const first = new FakeSafeStorage('first')
    await initializeDesktopLocalStateV1({ dataDir, backend: 'windows-dpapi', safeStorage: first })
    await expect(initializeDesktopLocalStateV1({
      dataDir,
      backend: 'windows-dpapi',
      safeStorage: new FakeSafeStorage('second'),
    })).rejects.toThrow(/could not be decrypted/)
    await expect(initializeDesktopLocalStateV1({
      dataDir,
      backend: 'macos-keychain',
      safeStorage: first,
    })).rejects.toThrow(/belongs to windows-dpapi/)
  })
})
