import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'

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
  canonicalAnalyticsGenerationIdSha256V1,
  canonicalEndpointScopeSha256V1,
  canonicalSourceRecordFingerprintSha256V1,
} from './canonical-history-identity.js'
import { projectCanonicalHistoryIncrementalV1 } from './canonical-history-incremental.js'
import {
  readCanonicalHistoryPublicationStateV1,
  type CanonicalHistoryPublicationSourceV1,
} from './canonical-history-publication-state.js'
import { defaultMetroraDataDir, readLocalEndpointIdentityMetadataV1 } from './endpoint-identity.js'
import {
  canonicalHistorySessionAuthorityForProjectionV1,
  expectedCanonicalHistorySessionAuthorityForSourcesV1,
  observeCanonicalHistoryParityV1,
  type CanonicalHistorySessionAuthorityV1,
  type CanonicalHistoryParityObservationV1,
} from './canonical-history-parity-observer.js'
import {
  projectCanonicalHistoryReadWithSourcesV1,
  type CanonicalHistoryReadProjectionV1,
} from './canonical-history-read-projection.js'
import { readCanonicalHistoryShadowHeadlineIndexFastV1 } from './canonical-history-shadow-headline-index-read.js'
import {
  persistCanonicalHistoryShadowV1,
  readCanonicalHistoryShadowStateV1,
  type PersistCanonicalHistoryShadowResultV1,
  type CanonicalHistoryShadowLoadedStateV1,
} from './canonical-history-shadow-store.js'

function publicationSourceIndexV1(
  sources: Array<{ provider: string; pathSha256: string; observationIds: string[]; activityIds: string[] }>,
  authorityGeneration: CurrentCacheAuthorityGenerationV1,
): CanonicalHistoryPublicationSourceV1[] {
  return sources.map(source => {
    const provider = authorityGeneration.session.providers.find(value => value.provider === source.provider)
    const file = provider?.files.find(value => value.pathSha256 === source.pathSha256)
    if (!provider || !file) throw new Error('canonical history source index is not covered by the session generation')
    return {
      ...source,
      envFingerprint: provider.envFingerprint,
      fingerprint: structuredClone(file.fingerprint),
    }
  })
}

function incrementalParityAuthorityV1(input: {
  endpointId: string
  sessionCache: SessionCache
  previousProjection: CanonicalHistoryReadProjectionV1
  previousState: NonNullable<Awaited<ReturnType<typeof readCanonicalHistoryPublicationStateV1>>>
  changedSourceKeys: ReadonlySet<string>
}): CanonicalHistorySessionAuthorityV1 {
  const previous = canonicalHistorySessionAuthorityForProjectionV1(input.previousProjection)
  const observations = new Map(previous.observations)
  const affectedActivityIds = new Set<string>()
  for (const source of input.previousState.sources) {
    const key = `${source.provider}\0${source.pathSha256}`
    if (!input.changedSourceKeys.has(key)) continue
    source.observationIds.forEach(id => observations.delete(id))
    source.activityIds.forEach(id => affectedActivityIds.add(id))
  }
  const previousActivities = new Map(input.previousProjection.activities.map(activity => [activity.activityId, activity]))
  const activities = new Set(previous.activities)
  for (const activityId of affectedActivityIds) {
    const activity = previousActivities.get(activityId)
    if (!activity) throw new Error('incremental parity state names a missing prior activity')
    const { activityId: _activityId, ...payload } = activity
    activities.delete(canonicalizeRfc8785(payload))
  }
  const changed = expectedCanonicalHistorySessionAuthorityForSourcesV1({
    endpointId: input.endpointId,
    sessionCache: input.sessionCache,
    sourceFingerprint: canonicalSourceRecordFingerprintSha256V1,
    sourceKeys: input.changedSourceKeys,
  })
  for (const [id, payload] of changed.observations) {
    const prior = observations.get(id)
    if (prior && canonicalizeRfc8785(prior) !== canonicalizeRfc8785(payload)) {
      throw new Error('incremental parity source identity resolved to a conflicting observation')
    }
    observations.set(id, prior ?? payload)
  }
  for (const activity of changed.activities) activities.add(activity)
  return { observations, activities }
}

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
    | 'endpoint-identity-unavailable'
    | 'generation-seal-failed'
    | 'unchanged-generation'
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
      id: canonicalAnalyticsGenerationIdSha256V1({
        sessionPayloadSha256: session.payloadSha256,
        dailyPayloadSha256: daily.payloadSha256,
        sourceManifestSha256: session.sourceManifestSha256,
      }),
      sessionPayloadSha256: session.payloadSha256,
      dailyPayloadSha256: daily.payloadSha256,
      sourceManifestSha256: session.sourceManifestSha256,
    }
  } catch {
    timings.generationSealMs = performance.now() - generationStartedAt
    return failed(startedAt, 'generation-seal-failed', timings)
  }
  timings.generationSealMs = performance.now() - generationStartedAt

  let endpointId = options.endpointId
  if (endpointId === undefined) {
    try {
      endpointId = (await readLocalEndpointIdentityMetadataV1({ dataDir: options.dataDir }))?.endpointId
    } catch {
      return failed(startedAt, 'endpoint-identity-unavailable', timings, generation)
    }
  }
  if (endpointId === undefined || endpointId.trim() === '') {
    return failed(startedAt, 'endpoint-identity-unavailable', timings, generation)
  }
  const endpointScopeSha256 = canonicalEndpointScopeSha256V1(endpointId)

  let compactForIncremental: Awaited<ReturnType<typeof readCanonicalHistoryShadowHeadlineIndexFastV1>> | undefined
  try {
    compactForIncremental = await readCanonicalHistoryShadowHeadlineIndexFastV1({ dataDir: options.dataDir })
    if (
      compactForIncremental
      && compactForIncremental.head.snapshotSha256 !== undefined
      && compactForIncremental.index.endpointScopeSha256 === endpointScopeSha256
      && compactForIncremental.index.projectionSha256 === compactForIncremental.head.projectionSha256
      && compactForIncremental.index.sessionAuthorityGenerationSha256 === generation.sessionPayloadSha256
      && compactForIncremental.index.dailyAuthorityGenerationSha256 === generation.dailyPayloadSha256
      && compactForIncremental.index.sessionSourceManifestSha256 === generation.sourceManifestSha256
      && compactForIncremental.index.analyticsGenerationId === generation.id
      && canonicalAnalyticsGenerationIdSha256V1({
        sessionPayloadSha256: compactForIncremental.index.sessionAuthorityGenerationSha256,
        dailyPayloadSha256: compactForIncremental.index.dailyAuthorityGenerationSha256,
        sourceManifestSha256: compactForIncremental.index.sessionSourceManifestSha256,
      }) === generation.id
    ) {
      timings.totalMs = performance.now() - startedAt
      return {
        status: 'skipped',
        reason: 'unchanged-generation',
        generation,
        projectionSha256: compactForIncremental.head.projectionSha256,
        shadowStatus: 'unchanged',
        timingsMs: timings,
      }
    }
  } catch {
    // A missing/corrupt derived fast artifact falls through to the canonical
    // projection and retained-history validation path.
  }

  let projection: CanonicalHistoryReadProjectionV1
  let sourceIndex: CanonicalHistoryPublicationSourceV1[] | undefined
  let previousState: CanonicalHistoryShadowLoadedStateV1 | undefined
  let incrementalParityAuthority: CanonicalHistorySessionAuthorityV1 | undefined
  const projectionStartedAt = performance.now()
  try {
    let incrementalUsed = false
    let derived: Awaited<ReturnType<typeof readCanonicalHistoryPublicationStateV1>>
    const sourceManifestChanged = compactForIncremental?.index.sessionSourceManifestSha256 !== generation.sourceManifestSha256
    if (sourceManifestChanged) {
      try {
        derived = await readCanonicalHistoryPublicationStateV1(options.dataDir ?? defaultMetroraDataDir())
      } catch {
        derived = undefined
      }
    }
    if (sourceManifestChanged && derived && derived.endpointScopeSha256 === endpointScopeSha256) {
      try {
        const loaded = await readCanonicalHistoryShadowStateV1({ dataDir: options.dataDir })
        if (
          loaded
          && derived.projectionSha256 === loaded.head.projectionSha256
          && derived.snapshotSha256 === loaded.head.snapshotSha256
          && canonicalAnalyticsGenerationIdSha256V1({
            sessionPayloadSha256: derived.sessionPayloadSha256,
            dailyPayloadSha256: derived.dailyPayloadSha256,
            sourceManifestSha256: derived.sourceManifestSha256,
          }) === derived.analyticsGenerationId
        ) {
          const incremental = projectCanonicalHistoryIncrementalV1({
            endpointId,
            sessionCache,
            dailyCache: options.dailyCache,
            sessionGeneration: authorityGeneration.session,
            previousProjection: loaded.snapshot.projection as CanonicalHistoryReadProjectionV1,
            previousState: derived,
          })
          projection = incremental.projection
          sourceIndex = incremental.sources
          previousState = loaded
          incrementalParityAuthority = incrementalParityAuthorityV1({
            endpointId,
            sessionCache,
            previousProjection: loaded.snapshot.projection as CanonicalHistoryReadProjectionV1,
            previousState: derived,
            changedSourceKeys: new Set(incremental.changedSourceKeys),
          })
          incrementalUsed = true
        }
      } catch {
        // Derived state is an acceleration artifact. Rebuild from the
        // canonical session/daily authorities when it is absent or invalid.
      }
    }
    if (!incrementalUsed) {
      const projected = projectCanonicalHistoryReadWithSourcesV1({ endpointId, sessionCache, dailyCache: options.dailyCache })
      projection = projected.projection
      sourceIndex = publicationSourceIndexV1(projected.sources, authorityGeneration)
    }
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
        ...(incrementalParityAuthority
          ? { expectedSessionAuthority: () => incrementalParityAuthority! }
          : {}),
        persist: async value => {
          timings.parityMs = performance.now() - parityStartedAt
          const shadowStartedAt = performance.now()
          persisted = await persistCanonicalHistoryShadowV1(value, {
            dataDir: options.dataDir,
            now: options.now,
            authorityGeneration,
            analyticsGenerationId: generation.id,
            endpointScopeSha256,
            sourceIndex,
            previousState,
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
