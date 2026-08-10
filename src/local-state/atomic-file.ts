import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const WINDOWS_MUTATION_RETRIES = 5
const TEMP_SUFFIX = '.metrora-tmp-'

function isBusyError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

function isMissingError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

async function retryMutation(operation: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < WINDOWS_MUTATION_RETRIES; attempt++) {
    try {
      await operation()
      return
    } catch (error) {
      if (isMissingError(error)) return
      if (!isBusyError(error) || attempt === WINDOWS_MUTATION_RETRIES - 1) throw error
      await delay(10 * (attempt + 1))
    }
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  const parent = dirname(path)
  try {
    const handle = await open(parent, 'r')
    try { await handle.sync() } finally { await handle.close() }
  } catch {
    // Directory fsync is unsupported on some Windows/filesystem combinations.
    // The file itself is already synced; this is a best-effort durability fence.
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
}

export async function atomicWritePrivateFile(path: string, payload: string | Uint8Array): Promise<void> {
  const parent = dirname(path)
  await ensurePrivateDirectory(parent)
  const tempPath = `${path}${TEMP_SUFFIX}${randomBytes(8).toString('hex')}`
  const handle = await open(tempPath, 'wx', 0o600)
  try {
    await handle.writeFile(payload)
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await retryMutation(() => rename(tempPath, path))
    await syncParentDirectory(path)
  } catch (error) {
    await retryMutation(() => unlink(tempPath)).catch(() => undefined)
    throw error
  }
}

export async function readOptionalPrivateFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch (error) {
    if (isMissingError(error)) return undefined
    throw error
  }
}

export async function removePrivateFile(path: string): Promise<void> {
  await retryMutation(() => unlink(path))
  await syncParentDirectory(path)
}

export async function cleanupStaleAtomicTemps(directory: string, maxAgeMs = 5 * 60 * 1000): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissingError(error)) return
    throw error
  }

  const cutoff = Date.now() - maxAgeMs
  await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.includes(TEMP_SUFFIX))
    .map(async entry => {
      const path = join(directory, entry.name)
      const info = await stat(path).catch(() => undefined)
      if (!info || info.mtimeMs > cutoff) return
      await rm(path, { force: true }).catch(() => undefined)
    }))
}
