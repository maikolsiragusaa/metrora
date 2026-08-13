import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { DAILY_CACHE_VERSION, dailyCachePath, type DailyCache } from '../daily-cache.js'
import {
  authorityGenerationForSidecarV1,
  readDailyCacheGenerationV1,
  readSessionCacheGenerationV1,
  type CurrentCacheAuthorityGenerationV1,
} from '../cache-generation.js'
import { isSnapshotReadMode } from '../read-lifecycle.js'
import { CACHE_VERSION, sessionCachePath, type SessionCache } from '../session-cache.js'
import { getLatestCompletedSessionCacheV1 } from '../session-cache-authority.js'
import {
  CANONICAL_ANALYTICS_HISTORY_SCOPE_ID_V1,
  canonicalSourceRecordFingerprintSha256V1,
} from './canonical-history-identity.js'
import {
  observeCanonicalHistoryParityV1,
  type CanonicalHistoryParityObservationV1,
} from './canonical-history-parity-observer.js'
import { projectCanonicalHistoryReadV1 } from './canonical-history-read-projection.js'
import {
  persistCanonicalHistoryShadowV1,
  type PersistCanonicalHistoryShadowResultV1,
} from './canonical-history-shadow-store.js'

export type CanonicalHistoryAnalyticsPublicationTimingsV1 = {
  generationSealMs: number
  projectionBuildMs: number
  parityMs: number
  shadowPersistenceMs: number
  headlineIndexPersistenceMs: number
  totalMs: number
}

export type CanonicalHistoryAnalyticsGenerationV1 = {
  id: string
  sessionPayloadSha256: string
  dailyPayloadSha256: string
  sourceManifestSha256: string
}

export type CanonicalHistoryAnalyticsPublicationV1 = {
  status: 'published' | 'skipped' | 'failed'
  reason?:
    | 'snapshot-read'
    | 'missing-in-memory-session-authority'
    | 'incomplete-session-authority'
    | 'untrusted-daily-authority'
    | 'generation-seal-failed'
    | 'parity-failed'
    | 'shadow-persistence-failed'
  generation?: CanonicalHistoryAnalyticsGenerationV1
  projectionSha256?: string
  shadowStatus?: PersistCanonicalHistoryShadowResultV1['status']
  timingsMs: CanonicalHistoryAnalyticsPublicationTimingsV1
  parity?: CanonicalHistoryParityObservationV1
}

export type CanonicalHistoryAnalyticsPublicationOptionsV1 = {
  sessionCache?: SessionCache
  dailyCache: DailyCache
  dataDir?: string
  endpointId?: string
  now?: () => Date
}

function generationId(
  sessionPayloadSha256: string,
  dailyPayloadSha256: string,
  sourceManifestSha256: string,
): string {
  return createHash('sha256')
    .update('metrora-analytics-refresh-generation-v1\0')
    .update(sessionPayloadSha256)
    .update('\0')
    .update(dailyPayloadSha256)
    .update('\0')
    .update(sourceManifestSha256)
    .digest('hex')
}

function emptyTimings(): CanonicalHistoryAnalyticsPublicationTimingsV1 {
  return {
    generationSealMs: 0,
    projectionBuildMs: 0,
    parityMs: 0,
    shadowPersistenceMs: 0,
    headlineIndexPersistenceMs: 0,
    totalMs: 0,
  }
}

function failed(
  startedAt: number,
  reason: CanonicalHistoryAnalyticsPublicationV1['reason'],
  timings: CanonicalHistoryAnalyticsPublicationTimingsV1,
  generation?: CanonicalHistoryAnalyticsGenerationV1,
): CanonicalHistoryAnalyticsPublicationV1 {
  timings.totalMs = performance.now() - startedAt
  return { status: 'failed', reason, ...(generation ? { generation } : {}), timingsMs: timings }
}

/**
 * Publish canonical analytics history from the completed ordinary analytics
 * lifecycle. This is the ownership boundary for C3: it is independent of
 * Workspace creation, evidence acceptance, disclosure, and candidate scans.
 *
 * The hook consumes the session authority already finalized by the parser and
 * the trusted daily object already returned by daily hydration. It never starts
 * discovery, parsing, hydration, or a cache reread of its own.
 */
export async function publishCanonicalHistoryAnalyticsV1(
  options: CanonicalHistoryAnalyticsPublicationOptionsV1,
): Promise<CanonicalHistoryAnalyticsPublicationV1> {
  const startedAt = performance.now()
  const timings = emptyTimings()
  if (isSnapshotReadMode()) {
    timings.totalMs = performance.now() - startedAt
    return { status: 'skipped', reason: 'snapshot-read', timingsMs: timings }
  }

  const sessionCache = options.sessionCache ?? getLatestCompletedSessionCacheV1()
  if (!sessionCache) return failed(startedAt, 'missing-in-memory-session-authority', timings)
  if (sessionCache.version !== CACHE_VERSION || sessionCache.complete !== true) {
    return failed(startedAt, 'incomplete-session-authority', timings)
  }
  if (
    options.dailyCache.version !== DAILY_CACHE_VERSION
    || options.dailyCache.complete !== true
    || options.dailyCache.watermarkTrusted !== true
  ) {
    return failed(startedAt, 'untrusted-daily-authority', timings)
  }

  // Mirror the two atomic save serializers. In particular, the daily trust
  // marker may be runtime-only/non-enumerable on an object returned by a
  // hydration helper, while saveDailyCache persists it explicitly when true.
  const sessionForPayload = { ...sessionCache } as SessionCache & { _dirty?: boolean }
  delete sessionForPayload._dirty
  const dailyForPayload = { ...options.dailyCache } as DailyCache
  if (options.dailyCache.watermarkTrusted === true) dailyForPayload.watermarkTrusted = true
  else delete dailyForPayload.watermarkTrusted
  const sessionPayload = JSON.stringify(sessionForPayload)
  const dailyPayload = JSON.stringify(dailyForPayload)
  let authorityGeneration: CurrentCacheAuthorityGenerationV1
  let generation: CanonicalHistoryAnalyticsGenerationV1
  const generationStartedAt = performance.now()
  try {
    // The cache save paths already publish these sidecars after their atomic
    // renames. Read the existing evidence only; this boundary must not mint a
    // stamp for an object that was not completed by the normal lifecycle.
    const [session, daily] = await Promise.all([
      readSessionCacheGenerationV1(sessionCachePath()),
      readDailyCacheGenerationV1(dailyCachePath()),
    ])
    if (!session || !daily || session.payloadSha256 !== sha256(sessionPayload) || daily.payloadSha256 !== sha256(dailyPayload)) {
      throw new Error('cache generation seal did not match the completed analytics objects')
    }
    authorityGeneration = { session, daily }
    generation = {
      id: generationId(session.payloadSha256, daily.payloadSha256, session.sourceManifestSha256),
      sessionPayloadSha256: session.payloadSha256,
      dailyPayloadSha256: daily.payloadSha256,
      sourceManifestSha256: session.sourceManifestSha256,
    }
  } catch {
    timings.generationSealMs = performance.now() - generationStartedAt
    return failed(startedAt, 'generation-seal-failed', timings)
  }
  timings.generationSealMs = performance.now() - generationStartedAt

  const endpointId = options.endpointId ?? CANONICAL_ANALYTICS_HISTORY_SCOPE_ID_V1
  let projection: ReturnType<typeof projectCanonicalHistoryReadV1>
  const projectionStartedAt = performance.now()
  try {
    projection = projectCanonicalHistoryReadV1({ endpointId, sessionCache, dailyCache: options.dailyCache })
  } catch {
    timings.projectionBuildMs = performance.now() - projectionStartedAt
    return failed(startedAt, 'parity-failed', timings, generation)
  }
  timings.projectionBuildMs = performance.now() - projectionStartedAt

  let persisted: PersistCanonicalHistoryShadowResultV1 | undefined
  let headlineIndexPersistenceMs = 0
  const parityStartedAt = performance.now()
  try {
    const observation = await observeCanonicalHistoryParityV1(
      { endpointId, sessionCache, dailyCache: options.dailyCache },
      {
        sourceFingerprint: canonicalSourceRecordFingerprintSha256V1,
        // The projection was built from the same in-memory objects above. The
        // observer still owns all parity assertions; this avoids a second
        // projection walk while preserving the established contract.
        project: () => projection,
        persist: async value => {
          timings.parityMs = performance.now() - parityStartedAt
          const shadowStartedAt = performance.now()
          persisted = await persistCanonicalHistoryShadowV1(value, {
            dataDir: options.dataDir,
            now: options.now,
            authorityGeneration,
            analyticsGenerationId: generation.id,
            onHeadlineIndexPersisted: elapsedMs => { headlineIndexPersistenceMs = elapsedMs },
          })
          timings.shadowPersistenceMs = performance.now() - shadowStartedAt
          return persisted
        },
      },
    )
    if (!persisted) throw new Error('canonical history shadow publication did not return a result')
    timings.headlineIndexPersistenceMs = headlineIndexPersistenceMs
    timings.totalMs = performance.now() - startedAt
    return {
      status: 'published',
      generation,
      projectionSha256: persisted.projectionSha256,
      shadowStatus: persisted.status,
      timingsMs: timings,
      parity: observation,
    }
  } catch {
    if (timings.parityMs === 0) timings.parityMs = performance.now() - parityStartedAt
    timings.headlineIndexPersistenceMs = headlineIndexPersistenceMs
    timings.totalMs = performance.now() - startedAt
    return failed(
      startedAt,
      persisted ? 'shadow-persistence-failed' : 'parity-failed',
      timings,
      generation,
    )
  }
}

export async function publishCanonicalHistoryAnalyticsSafelyV1(
  options: CanonicalHistoryAnalyticsPublicationOptionsV1,
): Promise<CanonicalHistoryAnalyticsPublicationV1> {
  try {
    return await publishCanonicalHistoryAnalyticsV1(options)
  } catch {
    return { status: 'failed', reason: 'shadow-persistence-failed', timingsMs: emptyTimings() }
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function analyticsGenerationForPublicationV1(
  publication: CanonicalHistoryAnalyticsPublicationV1,
): string | undefined {
  return publication.generation?.id
}

export function analyticsAuthoritySummaryV1(
  publication: CanonicalHistoryAnalyticsPublicationV1,
): { generationId?: string; projectionSha256?: string; shadowStatus?: string } {
  return {
    ...(publication.generation ? { generationId: publication.generation.id } : {}),
    ...(publication.projectionSha256 ? { projectionSha256: publication.projectionSha256 } : {}),
    ...(publication.shadowStatus ? { shadowStatus: publication.shadowStatus } : {}),
  }
}

export function authoritySidecarForPublicationV1(
  publication: CanonicalHistoryAnalyticsPublicationV1,
): ReturnType<typeof authorityGenerationForSidecarV1> | undefined {
  if (!publication.generation) return undefined
  return {
    sessionPayloadSha256: publication.generation.sessionPayloadSha256,
    dailyPayloadSha256: publication.generation.dailyPayloadSha256,
    sourceManifestSha256: publication.generation.sourceManifestSha256,
  }
}
