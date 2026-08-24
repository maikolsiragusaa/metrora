import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type AdvisorCredentialProvider = 'openai' | 'anthropic' | 'gemini'
export type AdvisorCredentialState = 'not-configured' | 'ready' | 'locked-unavailable' | 'invalid' | 'needs-reentry'
export type AdvisorCredentialStatus = { provider: AdvisorCredentialProvider; state: AdvisorCredentialState }

export type AdvisorSafeStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plaintext: string): Promise<Buffer>
  decryptStringAsync(ciphertext: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  getSelectedStorageBackend?(): string
}

export type AdvisorCredentialFileSystem = {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, options?: { mode?: number }): Promise<void>
  unlink(path: string): Promise<void>
}

const FILE_VERSION = 1 as const
const MAX_SECRET_BYTES = 16 * 1024
const PROVIDERS: readonly AdvisorCredentialProvider[] = ['openai', 'anthropic', 'gemini']

type CredentialFile = { version: typeof FILE_VERSION; records: Partial<Record<AdvisorCredentialProvider, string>> }

const defaultFileSystem: AdvisorCredentialFileSystem = {
  readFile: (path, encoding) => readFile(path, { encoding }),
  writeFile: (path, data, options) => writeFile(path, data, options),
  unlink: path => unlink(path),
}

function isProvider(value: string): value is AdvisorCredentialProvider {
  return (PROVIDERS as readonly string[]).includes(value)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function validCiphertext(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
}

function parseFile(value: string): CredentialFile | null {
  try {
    const parsed = JSON.parse(value) as { version?: unknown; records?: unknown }
    if (parsed.version !== FILE_VERSION || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) return null
    const records: Partial<Record<AdvisorCredentialProvider, string>> = {}
    for (const [provider, ciphertext] of Object.entries(parsed.records)) {
      if (!isProvider(provider) || !validCiphertext(ciphertext)) return null
      records[provider] = ciphertext
    }
    return { version: FILE_VERSION, records }
  } catch {
    return null
  }
}

export class AdvisorCredentialStore {
  readonly filePath: string
  private readonly platform: NodeJS.Platform
  private readonly safeStorage: AdvisorSafeStorage
  private readonly fileSystem: AdvisorCredentialFileSystem
  private operation: Promise<void> = Promise.resolve()

  constructor(options: { userDataPath: string; platform?: NodeJS.Platform; safeStorage: AdvisorSafeStorage; fileSystem?: AdvisorCredentialFileSystem }) {
    this.filePath = join(options.userDataPath, 'metrora-advisor-credentials-v1.json')
    this.platform = options.platform ?? process.platform
    this.safeStorage = options.safeStorage
    this.fileSystem = options.fileSystem ?? defaultFileSystem
  }

  private async secureBackendAvailable(): Promise<boolean> {
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) return false
    if (this.platform === 'linux') {
      const backend = this.safeStorage.getSelectedStorageBackend?.().toLowerCase() ?? 'unknown'
      return backend !== 'basic_text' && backend !== 'unknown' && backend !== 'plaintext'
    }
    return this.platform === 'win32' || this.platform === 'darwin'
  }

  private async readFile(): Promise<CredentialFile | null> {
    try {
      return parseFile(await this.fileSystem.readFile(this.filePath, 'utf8'))
    } catch {
      return null
    }
  }

  private async writeFile(records: Partial<Record<AdvisorCredentialProvider, string>>): Promise<void> {
    await this.fileSystem.writeFile(this.filePath, JSON.stringify({ version: FILE_VERSION, records }), { mode: 0o600 })
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.operation
    let release!: () => void
    this.operation = new Promise<void>(resolve => { release = resolve })
    await prior
    try { return await operation() } finally { release() }
  }

  async status(provider: AdvisorCredentialProvider): Promise<AdvisorCredentialStatus> {
    if (!(await this.secureBackendAvailable())) return { provider, state: 'locked-unavailable' }
    try {
      const file = await this.fileSystem.readFile(this.filePath, 'utf8')
      const parsed = parseFile(file)
      const ciphertext = parsed?.records[provider]
      if (!parsed) return { provider, state: 'needs-reentry' }
      if (!ciphertext) return { provider, state: 'not-configured' }
      const decrypted = await this.safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'))
      if (!decrypted.result || byteLength(decrypted.result) > MAX_SECRET_BYTES) return { provider, state: 'invalid' }
      return { provider, state: 'ready' }
    } catch {
      try {
        const exists = await this.fileSystem.readFile(this.filePath, 'utf8')
        return exists ? { provider, state: 'needs-reentry' } : { provider, state: 'not-configured' }
      } catch {
        return { provider, state: 'not-configured' }
      }
    }
  }

  async set(provider: AdvisorCredentialProvider, secret: string): Promise<AdvisorCredentialStatus> {
    return this.enqueue(async () => {
      if (!isProvider(provider) || !secret || byteLength(secret) > MAX_SECRET_BYTES) return { provider, state: 'invalid' }
      if (!(await this.secureBackendAvailable())) return { provider, state: 'locked-unavailable' }
      try {
        const encrypted = await this.safeStorage.encryptStringAsync(secret)
        const previous = await this.readFile()
        if (previous === null && await this.fileExists()) return { provider, state: 'needs-reentry' }
        const records = previous?.records ?? {}
        records[provider] = encrypted.toString('base64')
        await this.writeFile(records)
        return { provider, state: 'ready' }
      } catch {
        return { provider, state: 'needs-reentry' }
      }
    })
  }

  async clear(provider: AdvisorCredentialProvider): Promise<AdvisorCredentialStatus> {
    return this.enqueue(async () => {
      if (!(await this.secureBackendAvailable())) return { provider, state: 'locked-unavailable' }
      try {
        const previous = await this.readFile()
        const present = await this.fileExists()
        if (previous === null && present) return { provider, state: 'needs-reentry' }
        const records = previous?.records ?? {}
        delete records[provider]
        if (Object.keys(records).length) await this.writeFile(records)
        else if (present) {
          try { await this.fileSystem.unlink(this.filePath) }
          catch { return { provider, state: 'needs-reentry' } }
        }
        return { provider, state: 'not-configured' }
      } catch {
        return { provider, state: 'needs-reentry' }
      }
    })
  }

  /** Main-process-only secret access for a provider adapter; never expose this through IPC. */
  async readSecret(provider: AdvisorCredentialProvider): Promise<string | null> {
    return this.enqueue(async () => {
    if (!(await this.secureBackendAvailable())) return null
    const parsed = await this.readFile()
    const ciphertext = parsed?.records[provider]
    if (!ciphertext) return null
    try {
      const decrypted = await this.safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'))
      if (!decrypted.result || byteLength(decrypted.result) > MAX_SECRET_BYTES) return null
      if (decrypted.shouldReEncrypt) {
        const encrypted = await this.safeStorage.encryptStringAsync(decrypted.result)
        const records = parsed.records
        records[provider] = encrypted.toString('base64')
        await this.writeFile(records)
      }
      return decrypted.result
    } catch {
      return null
    }
    })
  }

  private async fileExists(): Promise<boolean> {
    try { await this.fileSystem.readFile(this.filePath, 'utf8'); return true } catch { return false }
  }
}
