import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { HarnessHostedProvider } from './harness-runtime-types.js'
import { isHarnessProtectedSecretReference } from './harness-mcp.mjs'

export type HarnessCredentialState = 'not-configured' | 'ready' | 'locked-unavailable' | 'invalid' | 'needs-reentry'
export type HarnessCredentialStatus = { provider: HarnessHostedProvider; state: HarnessCredentialState }
export type HarnessSecretReferenceStatus = { reference: string; state: HarnessCredentialState }
export type HarnessSafeStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plaintext: string): Promise<Buffer>
  decryptStringAsync(ciphertext: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}
export type HarnessCredentialFileSystem = {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, options?: { encoding?: 'utf8'; mode?: number }): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>
}

const PROVIDERS: readonly HarnessHostedProvider[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'opencode-zen']
const FILE_VERSION = 1

type CredentialFile = { version: 1; values: Record<string, string> }

function isProvider(value: unknown): value is HarnessHostedProvider { return typeof value === 'string' && PROVIDERS.includes(value as HarnessHostedProvider) }
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength }
function validCiphertext(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128 * 1024 }

/**
 * Credentials stay in the Electron main process and are encrypted with the
 * operating-system vault. The on-disk file is not part of the Harness profile
 * and no secret is ever returned to the renderer or persisted in a Session.
 */
export class HarnessCredentialStore {
  private readonly file: string
  private readonly platform: NodeJS.Platform
  private readonly safeStorage: HarnessSafeStorage
  private readonly fs: HarnessCredentialFileSystem
  private loaded: CredentialFile | null = null
  private mutationChain: Promise<void> = Promise.resolve()

  constructor(options: { userDataPath: string; platform?: NodeJS.Platform; safeStorage: HarnessSafeStorage; fileSystem?: HarnessCredentialFileSystem }) {
    this.file = path.join(path.resolve(options.userDataPath), 'harness', 'credentials.json')
    this.platform = options.platform ?? process.platform
    this.safeStorage = options.safeStorage
    this.fs = options.fileSystem ?? { readFile, writeFile, rename, mkdir }
  }

  async status(provider: HarnessHostedProvider): Promise<HarnessCredentialStatus> {
    if (!isProvider(provider)) throw new Error('Harness credential provider is invalid.')
    return { provider, state: await this.statusKey(provider) }
  }

  async set(provider: HarnessHostedProvider, secret: string): Promise<HarnessCredentialStatus> {
    if (!isProvider(provider)) throw new Error('Harness credential provider is invalid.')
    if (typeof secret !== 'string' || !secret.trim() || byteLength(secret) > 16 * 1024) return { provider, state: 'invalid' }
    return { provider, state: await this.setKey(provider, secret) }
  }

  async clear(provider: HarnessHostedProvider): Promise<HarnessCredentialStatus> {
    if (!isProvider(provider)) throw new Error('Harness credential provider is invalid.')
    return { provider, state: await this.clearKey(provider) }
  }

  async readSecret(provider: HarnessHostedProvider): Promise<string | null> {
    if (!isProvider(provider)) return null
    return this.readSecretKey(provider)
  }

  async statusReference(reference: string): Promise<HarnessSecretReferenceStatus> {
    if (!isHarnessProtectedSecretReference(reference)) throw new Error('Harness protected secret reference is invalid.')
    return { reference, state: await this.statusKey(reference) }
  }

  async setReference(reference: string, secret: string): Promise<HarnessSecretReferenceStatus> {
    if (!isHarnessProtectedSecretReference(reference)) throw new Error('Harness protected secret reference is invalid.')
    if (typeof secret !== 'string' || !secret.trim() || byteLength(secret) > 16 * 1024) return { reference, state: 'invalid' }
    return { reference, state: await this.setKey(reference, secret) }
  }

  async clearReference(reference: string): Promise<HarnessSecretReferenceStatus> {
    if (!isHarnessProtectedSecretReference(reference)) throw new Error('Harness protected secret reference is invalid.')
    return { reference, state: await this.clearKey(reference) }
  }

  async readReference(reference: string): Promise<string | null> {
    if (!isHarnessProtectedSecretReference(reference)) return null
    return this.readSecretKey(reference)
  }

  private async readSecretKey(key: string): Promise<string | null> {
    if (!(await this.safeStorage.isAsyncEncryptionAvailable().catch(() => false))) return null
    const ciphertext = (await this.loadFile()).values[key]
    if (!validCiphertext(ciphertext)) return null
    try {
      const decrypted = await this.safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'))
      const value = decrypted.result
      if (!value || byteLength(value) > 16 * 1024) return null
      if (decrypted.shouldReEncrypt) {
        const refreshed = (await this.safeStorage.encryptStringAsync(value)).toString('base64')
        await this.mutate(async () => {
          const current = await this.loadFile()
          current.values[key] = refreshed
          await this.saveFile(current)
        })
      }
      return value
    } catch { return null }
  }

  private async statusKey(key: string): Promise<HarnessCredentialState> {
    const available = await this.safeStorage.isAsyncEncryptionAvailable().catch(() => false)
    if (!available) return 'locked-unavailable'
    const value = await this.readSecretKey(key)
    return value ? 'ready' : 'not-configured'
  }

  private async setKey(key: string, secret: string): Promise<HarnessCredentialState> {
    if (!(await this.safeStorage.isAsyncEncryptionAvailable().catch(() => false))) return 'locked-unavailable'
    try {
      const ciphertext = (await this.safeStorage.encryptStringAsync(secret.trim())).toString('base64')
      await this.mutate(async () => {
        const current = await this.loadFile()
        current.values[key] = ciphertext
        await this.saveFile(current)
      })
      return 'ready'
    } catch { return 'needs-reentry' }
  }

  private async clearKey(key: string): Promise<HarnessCredentialState> {
    try {
      await this.mutate(async () => {
        const current = await this.loadFile()
        delete current.values[key]
        await this.saveFile(current)
      })
      return 'not-configured'
    } catch { return 'needs-reentry' }
  }

  private async loadFile(): Promise<CredentialFile> {
    if (this.loaded) return structuredClone(this.loaded)
    try {
      const value = JSON.parse(await this.fs.readFile(this.file, 'utf8')) as unknown
      const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      const values: CredentialFile['values'] = {}
      const encrypted = row.values && typeof row.values === 'object' && !Array.isArray(row.values) ? row.values as Record<string, unknown> : {}
      for (const [key, value] of Object.entries(encrypted).slice(0, 128)) {
        if ((!isProvider(key) && !isHarnessProtectedSecretReference(key)) || !validCiphertext(value)) continue
        values[key] = value
      }
      this.loaded = { version: FILE_VERSION, values }
    } catch { this.loaded = { version: FILE_VERSION, values: {} } }
    return structuredClone(this.loaded)
  }

  private async saveFile(value: CredentialFile): Promise<void> {
    this.loaded = { version: FILE_VERSION, values: { ...value.values } }
    await this.fs.mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await this.fs.writeFile(temp, JSON.stringify(this.loaded) + '\n', { encoding: 'utf8', mode: this.platform === 'win32' ? undefined : 0o600 })
    await this.fs.rename(temp, this.file)
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    let result!: T
    const next = this.mutationChain.then(async () => { result = await operation() })
    this.mutationChain = next.then(() => undefined, () => undefined)
    await next
    return result
  }
}
