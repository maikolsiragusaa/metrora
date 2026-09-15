import { stat } from 'fs/promises'

import { sessionCachePath } from './session-cache.js'

/** Stable vintage stamp for data derived from the published session cache. */
export async function sessionCacheFingerprint(): Promise<string | null> {
  try {
    const stats = await stat(sessionCachePath())
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return null
  }
}
