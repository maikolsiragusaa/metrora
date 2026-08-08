/**
 * metrora sync — OS credential storage.
 *
 * Stores refresh tokens in the OS keychain.
 * Falls back to a 0600 file when no keychain is available.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs'
import { join } from 'path'
import { getMetroraConfigDir } from '../product-paths.js'

const SERVICE_NAME = 'metrora-sync'
const LEGACY_SERVICE_NAMES = ['metrora-sync', 'metrora-sync'] as const
const ACCOUNT_NAME = 'refresh-token'

export type StorageMethod = 'keychain' | 'secret-tool' | 'dpapi' | 'file'

export interface CredentialStore {
  store(token: string): void
  retrieve(): string | null
  delete(): void
  method(): StorageMethod
}

// --- macOS Keychain ---

function readMacKeychain(service: string): string | null {
  try {
    const result = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', ACCOUNT_NAME, '-w'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return result.trim() || null
  } catch {
    return null
  }
}

function deleteMacKeychain(service: string): void {
  try {
    execFileSync('security', ['delete-generic-password', '-s', service, '-a', ACCOUNT_NAME], { stdio: 'pipe' })
  } catch { /* may not exist */ }
}

class KeychainStore implements CredentialStore {
  store(token: string): void {
    deleteMacKeychain(SERVICE_NAME)
    execFileSync('security', ['add-generic-password', '-s', SERVICE_NAME, '-a', ACCOUNT_NAME, '-w', token], { stdio: 'pipe' })
  }

  retrieve(): string | null {
    const canonical = readMacKeychain(SERVICE_NAME)
    if (canonical) return canonical

    for (const legacy of LEGACY_SERVICE_NAMES) {
      const token = readMacKeychain(legacy)
      if (!token) continue
      // Adopt the credential into the canonical service while preserving the
      // source entry until the canonical write succeeds.
      this.store(token)
      deleteMacKeychain(legacy)
      return token
    }
    return null
  }

  delete(): void {
    deleteMacKeychain(SERVICE_NAME)
    for (const legacy of LEGACY_SERVICE_NAMES) deleteMacKeychain(legacy)
  }

  method(): StorageMethod { return 'keychain' }
}

// --- Linux libsecret ---

function readSecretTool(service: string): string | null {
  try {
    const result = execFileSync(
      'secret-tool',
      ['lookup', 'service', service, 'account', ACCOUNT_NAME],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return result.trim() || null
  } catch {
    return null
  }
}

function deleteSecretTool(service: string): void {
  try {
    execFileSync('secret-tool', ['clear', 'service', service, 'account', ACCOUNT_NAME], { stdio: 'pipe' })
  } catch { /* may not exist */ }
}

class SecretToolStore implements CredentialStore {
  store(token: string): void {
    execFileSync(
      'secret-tool',
      ['store', `--label=${SERVICE_NAME}`, 'service', SERVICE_NAME, 'account', ACCOUNT_NAME],
      { input: token, stdio: ['pipe', 'pipe', 'pipe'] },
    )
  }

  retrieve(): string | null {
    const canonical = readSecretTool(SERVICE_NAME)
    if (canonical) return canonical

    for (const legacy of LEGACY_SERVICE_NAMES) {
      const token = readSecretTool(legacy)
      if (!token) continue
      this.store(token)
      deleteSecretTool(legacy)
      return token
    }
    return null
  }

  delete(): void {
    deleteSecretTool(SERVICE_NAME)
    for (const legacy of LEGACY_SERVICE_NAMES) deleteSecretTool(legacy)
  }

  method(): StorageMethod { return 'secret-tool' }
}

// --- Windows DPAPI ---

class DpapiStore implements CredentialStore {
  private filePath: string

  constructor() {
    this.filePath = join(getMetroraConfigDir(), '.sync-token-dpapi')
  }

  store(token: string): void {
    // Token passed via environment variable — never in argv or command string.
    const ps = `$s = ConvertTo-SecureString $env:METRORA_SYNC_TOKEN -AsPlainText -Force; ConvertFrom-SecureString $s`
    const encrypted = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, METRORA_SYNC_TOKEN: token },
    }).trim()

    const dir = getMetroraConfigDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, encrypted, { mode: 0o600 })
  }

  retrieve(): string | null {
    if (!existsSync(this.filePath)) return null
    try {
      const encrypted = readFileSync(this.filePath, 'utf-8').trim()
      const ps = `$s = ConvertTo-SecureString $env:METRORA_SYNC_BLOB; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`
      const result = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, METRORA_SYNC_BLOB: encrypted },
      })
      return result.trim() || null
    } catch {
      return null
    }
  }

  delete(): void {
    try { unlinkSync(this.filePath) } catch { /* may not exist */ }
  }

  method(): StorageMethod { return 'dpapi' }
}

// --- File Fallback ---

class FileStore implements CredentialStore {
  private filePath: string

  constructor() {
    this.filePath = join(getMetroraConfigDir(), '.sync-token')
  }

  store(token: string): void {
    const dir = getMetroraConfigDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, token, { mode: 0o600 })
    // Ensure permissions (writeFile mode doesn't always work on existing files)
    try { chmodSync(this.filePath, 0o600) } catch {}
  }

  retrieve(): string | null {
    if (!existsSync(this.filePath)) return null
    try {
      return readFileSync(this.filePath, 'utf-8').trim() || null
    } catch {
      return null
    }
  }

  delete(): void {
    try { unlinkSync(this.filePath) } catch { /* may not exist */ }
  }

  method(): StorageMethod { return 'file' }
}

// --- Factory ---

function isCommandAvailable(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which'
    execFileSync(probe, [cmd], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function createCredentialStore(): CredentialStore {
  // Test/CI escape hatch: force the file store (respects $HOME, so tests
  // can fully isolate with a temp HOME). Canonical env wins; legacy names stay
  // accepted only as temporary compatibility aliases.
  const forcedStore = process.env.METRORA_SYNC_TOKEN_STORE
    ?? process.env.METRORA_SYNC_TOKEN_STORE
    ?? process.env.METRORA_SYNC_TOKEN_STORE
  if (forcedStore === 'file') {
    return new FileStore()
  }

  if (process.platform === 'darwin') {
    return new KeychainStore()
  }

  if (process.platform === 'win32') {
    return new DpapiStore()
  }

  // Linux: try secret-tool, fall back to file
  if (isCommandAvailable('secret-tool')) {
    // Also verify the keyring daemon is running.
    try {
      execFileSync('secret-tool', ['lookup', 'service', '__metrora_probe__', 'account', '__probe__'], { stdio: 'pipe' })
      return new SecretToolStore()
    } catch (err) {
      // Exit code 1 = not found (keyring works). Other errors = keyring not running.
      if ((err as { status?: number }).status === 1) {
        return new SecretToolStore()
      }
    }
  }

  return new FileStore()
}
