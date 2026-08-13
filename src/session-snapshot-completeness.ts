import { collectJsonlFiles } from './parser.js'
import { discoverAllSessions, discoverAllSessionsForFreshness, getProvider } from './providers/index.js'
import type { SessionSource } from './providers/types.js'
import {
  sessionGenerationSourcePathSha256V1,
  type SessionCacheGenerationV1,
} from './cache-generation.js'
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
type SnapshotSourceAuthority = {
  complete: boolean
  provider(provider: string): {
    envFingerprint: string
    file(path: string): { fingerprint: FileFingerprint } | undefined
  } | undefined
}

async function assessSourceAuthority(
  authority: SnapshotSourceAuthority,
  sources: SessionSource[],
): Promise<SessionSnapshotCompleteness> {
  if (!authority.complete) return 'degraded'

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
    const section = authority.provider(source.provider)
    if (!section || section.envFingerprint !== computeEnvFingerprint(source.provider)) return 'degraded'

    for (const path of await discoveredPaths(source)) {
      const cached = section.file(path)
      const current = await fingerprintFile(path)
      if (!cached || !current || !sameFingerprint(cached.fingerprint, current)) return 'degraded'
    }
  }

  return 'complete'
}

export async function assessSessionSnapshotCompleteness(
  cache: SessionCache,
  sources: SessionSource[],
): Promise<SessionSnapshotCompleteness> {
  return assessSourceAuthority({
    complete: isCacheComplete(cache),
    provider: provider => {
      const section = cache.providers[provider]
      return section
        ? { envFingerprint: section.envFingerprint, file: path => section.files[path] }
        : undefined
    },
  }, sources)
}

/**
 * The same completeness rules as assessSessionSnapshotCompleteness(), backed
 * by the compact private generation manifest rather than a full cache parse.
 * The manifest contains path digests only; raw source locators remain local to
 * the discovery/fingerprint boundary.
 */
export async function assessSessionSnapshotGenerationCompletenessV1(
  generation: SessionCacheGenerationV1,
  sources: SessionSource[],
): Promise<SessionSnapshotCompleteness> {
  const providers = new Map(generation.providers.map(section => [
    section.provider,
    {
      envFingerprint: section.envFingerprint,
      files: new Map(section.files.map(file => [file.pathSha256, { fingerprint: file.fingerprint }])),
    },
  ]))
  return assessSourceAuthority({
    complete: generation.complete,
    provider: provider => {
      const section = providers.get(provider)
      return section
        ? {
            envFingerprint: section.envFingerprint,
            file: path => {
              const file = section.files.get(sessionGenerationSourcePathSha256V1(provider, path))
              return file ? { fingerprint: file.fingerprint } : undefined
            },
          }
        : undefined
    },
  }, sources)
}

/**
 * Fast source-live freshness check for a persisted generation. Codex can list
 * candidate rollouts without opening every file. An uncovered candidate is a
 * conservative degraded result; the next normal refresh can establish a new
 * complete generation. This avoids accepting a candidate that full discovery
 * might later reject, and never weakens the shared completeness semantics.
 */
export async function currentSessionSnapshotGenerationCompletenessV1(
  generation: SessionCacheGenerationV1,
  providerFilter = 'all',
): Promise<SessionSnapshotCompleteness> {
  const fast = await discoverAllSessionsForFreshness(providerFilter)
  const sourcePaths = new Map(generation.providers.map(section => [
    section.provider,
    new Set(section.files.map(file => file.pathSha256)),
  ]))
  const fastCoverage = [...fast.fastProviders].every(provider => fast.sources
    .filter(source => source.provider === provider)
    .every(source => sourcePaths.get(provider)?.has(sessionGenerationSourcePathSha256V1(provider, source.path)) === true))
  if (!fastCoverage) return 'degraded'
  const sources = fast.sources
  return assessSessionSnapshotGenerationCompletenessV1(generation, sources)
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
