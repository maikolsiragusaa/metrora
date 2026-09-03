import { describe, expect, it } from 'vitest'

import { HarnessCredentialStore } from './harness-credentials.mjs'

function memoryStore(available = true) {
  const files = new Map<string, string>()
  const store = new HarnessCredentialStore({
    userDataPath: 'C:\\metrora-credentials-test',
    platform: 'win32',
    safeStorage: {
      isAsyncEncryptionAvailable: async () => available,
      encryptStringAsync: async plaintext => Buffer.from(`cipher:${plaintext}`, 'utf8'),
      decryptStringAsync: async ciphertext => ({ result: ciphertext.toString('utf8').slice('cipher:'.length), shouldReEncrypt: false }),
    },
    fileSystem: {
      readFile: async file => {
        const value = files.get(file)
        if (value === undefined) throw new Error('missing')
        return value
      },
      writeFile: async (file, data) => { files.set(file, data) },
      rename: async (from, to) => { files.set(to, files.get(from) ?? ''); files.delete(from) },
      mkdir: async () => undefined,
    },
  })
  return { store, files }
}

describe('Harness protected credentials', () => {
  it('stores MCP references in the main-process vault without returning the secret', async () => {
    const { store, files } = memoryStore()
    const reference = 'mcp:fixture:TOKEN'
    await expect(store.statusReference(reference)).resolves.toEqual({ reference, state: 'not-configured' })
    await expect(store.setReference(reference, 'mcp-secret-value')).resolves.toEqual({ reference, state: 'ready' })
    await expect(store.statusReference(reference)).resolves.toEqual({ reference, state: 'ready' })
    await expect(store.readReference(reference)).resolves.toBe('mcp-secret-value')
    const persisted = [...files.values()].join('\n')
    expect(persisted).toContain(reference)
    expect(persisted).not.toContain('mcp-secret-value')
    await expect(store.clearReference(reference)).resolves.toEqual({ reference, state: 'not-configured' })
    await expect(store.readReference(reference)).resolves.toBeNull()
  })

  it('rejects invalid references and fails closed when OS encryption is unavailable', async () => {
    const unavailable = memoryStore(false).store
    await expect(unavailable.statusReference('not-a-reference')).rejects.toThrow('invalid')
    await expect(unavailable.setReference('mcp:fixture:TOKEN', 'value')).resolves.toEqual({ reference: 'mcp:fixture:TOKEN', state: 'locked-unavailable' })
    await expect(unavailable.readReference('mcp:fixture:TOKEN')).resolves.toBeNull()
    const { store } = memoryStore()
    await expect(store.setReference('mcp:fixture:TOKEN', '')).resolves.toEqual({ reference: 'mcp:fixture:TOKEN', state: 'invalid' })
  })
})
