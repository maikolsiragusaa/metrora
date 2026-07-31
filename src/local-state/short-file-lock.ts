import { randomBytes } from 'node:crypto'
import { open, readFile, stat, unlink, utimes } from 'node:fs/promises'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

async function readStableToken(path: string): Promise<{ token: string; mtimeMs: number } | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const before = await stat(path)
      const raw = await readFile(path, 'utf-8')
      const after = await stat(path)
      if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
        await delay(1)
        continue
      }
      const parsed = JSON.parse(raw) as { token?: unknown }
      if (typeof parsed.token !== 'string' || parsed.token.length < 16) return undefined
      return { token: parsed.token, mtimeMs: after.mtimeMs }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined
      await delay(1)
    }
  }
  return undefined
}

async function removeWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await unlink(path)
      return
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT') return
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || attempt === 4) throw error
      await delay(10 * (attempt + 1))
    }
  }
}

let inProcessTail: Promise<void> = Promise.resolve()

async function enterInProcessQueue(): Promise<() => void> {
  const previous = inProcessTail
  let release!: () => void
  inProcessTail = new Promise<void>(resolve => { release = resolve })
  await previous
  return release
}

export async function withShortFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: { waitMs?: number; staleMs?: number; pollMs?: number } = {},
): Promise<T> {
  const leaveQueue = await enterInProcessQueue()
  const waitMs = options.waitMs ?? 10_000
  const staleMs = options.staleMs ?? 30_000
  const pollMs = options.pollMs ?? 25
  const token = randomBytes(16).toString('hex')
  const body = JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })
  const deadline = Date.now() + waitMs
  let acquired = false

  try {
    while (!acquired) {
      try {
        const handle = await open(lockPath, 'wx', 0o600)
        try {
          await handle.writeFile(body, 'utf-8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        acquired = true
        break
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error
      }

      const observed = await readStableToken(lockPath)
      if (observed && Date.now() - observed.mtimeMs > staleMs) {
        const rechecked = await readStableToken(lockPath)
        if (rechecked && rechecked.token === observed.token && rechecked.mtimeMs === observed.mtimeMs) {
          await removeWithRetry(lockPath).catch(() => undefined)
          continue
        }
      }
      if (Date.now() >= deadline) throw new Error('timed out waiting for local outbox lock')
      await delay(pollMs)
    }

    // Refresh mtime once after acquisition so a slow filesystem write does not
    // make a newly-created lock appear stale to a contender.
    const now = new Date()
    await utimes(lockPath, now, now).catch(() => undefined)
    return await operation()
  } finally {
    if (acquired) {
      const current = await readStableToken(lockPath)
      if (current?.token === token) await removeWithRetry(lockPath).catch(() => undefined)
    }
    leaveQueue()
  }
}
