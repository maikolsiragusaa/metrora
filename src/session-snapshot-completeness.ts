import { collectJsonlFiles } from './parser.js'
import { discoverAllSessions, getProvider } from './providers/index.js'
import type { SessionSource } from './providers/types.js'
import {
  computeEnvFingerprint,
  fingerprintFile,
  isCacheComplete,
  loadCache,
  type FileFingerprint,
  type SessionCache,
} from './session-cache.js'

export type SessionSnapshotCompleteness = 'complete' | 'degraded'

function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mtimeMs === right.mtimeMs
    && left.sizeBytes === right.sizeBytes
}

async function discoveredPaths(source: SessionSource): Promise<string[]> {
  return source.provider === 'claude'
    ? collectJsonlFiles(source.path)
    : [source.path]
}

/**
 * Decide whether a read-only parse served the complete current source set.
 *
 * Session-cache hydration, parse completion and daily-cache completeness are
 * deliberately separate authorities. A complete session cache can still be a
 * stale read-only snapshot when a source appeared or changed after publication.
 * Only a fingerprint-identical discovered set may authorize the daily watermark.
 */
export async function assessSessionSnapshotCompleteness(
  cache: SessionCache,
  sources: SessionSource[],
): Promise<SessionSnapshotCompleteness> {
  if (!isCacheComplete(cache)) return 'degraded'

  const providerNetwork = new Map<string, boolean>()
  for (const source of sources) {
    let network = providerNetwork.get(source.provider)
    if (network === undefined) {
      network = (await getProvider(source.provider))?.network === true
      providerNetwork.set(source.provider, network)
    }
    // Network providers are fetched live and deliberately have no file
    // fingerprint authority in the session cache.
    if (network) continue

    const section = cache.providers[source.provider]
    if (!section || section.envFingerprint !== computeEnvFingerprint(source.provider)) {
      return 'degraded'
    }

    for (const path of await discoveredPaths(source)) {
      const cached = section.files[path]
      const current = await fingerprintFile(path)
      if (!cached || !current || !sameFingerprint(cached.fingerprint, current)) {
        return 'degraded'
      }
    }
  }

  return 'complete'
}

export async function currentSessionSnapshotCompleteness(
  providerFilter: string = 'all',
): Promise<SessionSnapshotCompleteness> {
  const [cache, sources] = await Promise.all([
    loadCache(),
    discoverAllSessions(providerFilter),
  ])
  return assessSessionSnapshotCompleteness(cache, sources)
}
