import { acquireCacheRefreshLock } from '../cache-refresh-lock.js'
import { ensurePrivateDirectory } from './atomic-file.js'

/**
 * Run a short local-state transaction under the already-hardened cache lease.
 * Each caller supplies a dedicated directory, so the cache lock filenames do
 * not collide with the session cache or with other local-state domains.
 */
export async function withLocalStateLease<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  await ensurePrivateDirectory(directory)
  for (let attempt = 0; attempt < 5; attempt++) {
    const outcome = await acquireCacheRefreshLock({
      cacheDir: directory,
      heartbeatMs: 1_000,
      staleMs: 30_000,
      waitMs: 10_000,
      pollMs: 25,
    })
    if (outcome.outcome === 'completed-by-other') continue
    if (outcome.outcome === 'timed-out') throw new Error('timed out waiting for local-state lease')
    if (outcome.outcome === 'unavailable') throw new Error('local-state lease is unavailable')
    try {
      return await operation()
    } finally {
      await outcome.handle.release()
    }
  }
  throw new Error('local-state lease changed owners repeatedly')
}
