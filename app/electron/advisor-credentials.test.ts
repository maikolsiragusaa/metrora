import { describe, expect, it } from 'vitest'
import { AdvisorCredentialStore, type AdvisorCredentialFileSystem, type AdvisorSafeStorage } from './advisor-credentials'

function fixture(options: { platform?: NodeJS.Platform; backend?: string; failWrite?: boolean; failUnlink?: boolean; reEncrypt?: boolean; decryptDelayMs?: number; secureReadError?: string } = {}) {
  const files = new Map<string, string>()
  const writes: string[] = []
  const fileSystem: AdvisorCredentialFileSystem = {
    readSecureFile: async (path: string, maxBytes: number) => {
      if (options.secureReadError) throw new Error(options.secureReadError)
      const value = files.get(path)
      if (value === undefined) return null
      if (new TextEncoder().encode(value).byteLength > maxBytes) throw new Error('too large')
      return value
    },
    atomicWriteSecureFile: async (path, data) => {
      if (options.failWrite) throw new Error('write failed')
      writes.push(data)
      files.set(path, data)
    },
    unlink: async path => { if (options.failUnlink) throw new Error('unlink failed'); files.delete(path) },
  }
  const safeStorage: AdvisorSafeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from('cipher:' + value, 'utf8'),
    decryptStringAsync: async value => {
      if (options.decryptDelayMs) await new Promise(resolve => setTimeout(resolve, options.decryptDelayMs))
      return { result: value.toString('utf8').replace(/^cipher:/u, ''), shouldReEncrypt: options.reEncrypt === true }
    },
    getSelectedStorageBackend: () => options.backend ?? 'os_crypt',
  }
  return { store: new AdvisorCredentialStore({ userDataPath: 'C:/user-data', platform: options.platform ?? 'win32', safeStorage, fileSystem }), files, writes }
}

describe('Advisor BYOK credential store', () => {
  it('stores ciphertext only and never returns the key from status', async () => {
    const { store, files } = fixture()
    const saved = await store.set('openai', 'secret-value')
    expect(saved).toEqual({ provider: 'openai', state: 'ready' })
    const file = [...files.values()][0]!
    expect(file).not.toContain('secret-value')
    expect(await store.status('openai')).toEqual({ provider: 'openai', state: 'ready' })
    expect(await store.readSecret('openai')).toBe('secret-value')
  })

  it.each(['openrouter', 'opencode-zen'] as const)('stores %s credentials in the same protected main-process store', async provider => {
    const { store, files } = fixture()
    expect(await store.set(provider, provider + '-secret')).toEqual({ provider, state: 'ready' })
    expect(await store.status(provider)).toEqual({ provider, state: 'ready' })
    expect(await store.readSecret(provider)).toBe(provider + '-secret')
    expect([...files.values()][0]).not.toContain(provider + '-secret')
  })

  it('fails closed for Linux basic_text fallback', async () => {
    const { store } = fixture({ platform: 'linux', backend: 'basic_text' })
    expect(await store.set('gemini', 'secret-value')).toEqual({ provider: 'gemini', state: 'locked-unavailable' })
    expect(await store.status('gemini')).toEqual({ provider: 'gemini', state: 'locked-unavailable' })
  })

  it('accepts a protected Linux backend', async () => {
    const { store } = fixture({ platform: 'linux', backend: 'gnome-libsecret' })
    expect(await store.set('anthropic', 'secret-value')).toEqual({ provider: 'anthropic', state: 'ready' })
  })

  it('requires re-entry when the ciphertext file cannot be written', async () => {
    const { store } = fixture({ failWrite: true })
    expect(await store.set('openai', 'secret-value')).toEqual({ provider: 'openai', state: 'needs-reentry' })
  })

  it('does not retain a credential after clear', async () => {
    const { store } = fixture()
    await store.set('openai', 'secret-value')
    expect(await store.clear('openai')).toEqual({ provider: 'openai', state: 'not-configured' })
    expect(await store.status('openai')).toEqual({ provider: 'openai', state: 'not-configured' })
    expect(await store.readSecret('openai')).toBeNull()
  })
  it('fails closed when encrypted credential removal cannot unlink the file', async () => {
    const { store } = fixture({ failUnlink: true })
    await store.set('openai', 'secret-value')
    expect(await store.clear('openai')).toEqual({ provider: 'openai', state: 'needs-reentry' })
    expect(await store.readSecret('openai')).toBe('secret-value')
  })

  it('serializes re-encryption with replacement so an old secret cannot resurrect', async () => {
    const { store } = fixture({ reEncrypt: true, decryptDelayMs: 10 })
    await store.set('openai', 'old-secret')
    const read = store.readSecret('openai')
    const replace = store.set('openai', 'new-secret')
    await Promise.all([read, replace])
    expect(await store.readSecret('openai')).toBe('new-secret')
  })
  it.each(['Refusing symbolic link', 'Credential file permissions are too broad'])('fails closed when the secure-file primitive rejects unsafe credential storage: %s', async secureReadError => {
    const { store } = fixture({ secureReadError })
    expect(await store.status('openai')).toEqual({ provider: 'openai', state: 'needs-reentry' })
    expect(await store.readSecret('openai')).toBeNull()
  })

  it('fails closed for corrupt and oversized credential state', async () => {
    const corrupt = fixture()
    corrupt.files.set(corrupt.store.filePath, JSON.stringify({ version: 1, records: { openai: '%%%not-ciphertext%%%' } }))
    expect(await corrupt.store.status('openai')).toEqual({ provider: 'openai', state: 'needs-reentry' })

    const oversized = fixture()
    oversized.files.set(oversized.store.filePath, 'x'.repeat(64 * 1024 + 1))
    expect(await oversized.store.status('openai')).toEqual({ provider: 'openai', state: 'needs-reentry' })
  })

  it('rewrites re-encrypted ciphertext through the atomic writer', async () => {
    const { store, writes } = fixture({ reEncrypt: true })
    await store.set('openai', 'secret-value')
    const initialWrites = writes.length
    expect(await store.readSecret('openai')).toBe('secret-value')
    expect(writes).toHaveLength(initialWrites + 1)
    expect(writes.at(-1)).not.toContain('secret-value')
  })
})
