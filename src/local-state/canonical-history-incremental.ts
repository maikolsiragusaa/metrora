import type {
  SessionCacheGenerationV1,
  SessionSourceGenerationFileV1,
  SessionSourceGenerationProviderV1,
} from '../cache-generation.js'
import type { DailyCache } from '../daily-cache.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import {
  projectCanonicalHistoryReadWithSourcesV1,
  type CanonicalHistoryReadProjectionInputV1,
  type CanonicalHistoryReadProjectionSourceV1,
  type CanonicalHistoryReadProjectionV1,
} from './canonical-history-read-projection.js'
import type { CanonicalHistoryPublicationSourceV1, CanonicalHistoryPublicationStateV1 } from './canonical-history-publication-state.js'
import type { SessionCache } from '../session-cache.js'

export class CanonicalHistoryIncrementalProjectionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalHistoryIncrementalProjectionUnavailableError'
  }
}

export type CanonicalHistoryIncrementalProjectionResultV1 = {
  projection: CanonicalHistoryReadProjectionV1
  sources: CanonicalHistoryPublicationSourceV1[]
  changedSourceCount: number
  changedSourceKeys: string[]
}

type SourceKey = string

function sourceKey(provider: string, pathSha256: string): SourceKey {
  return `${provider}\0${pathSha256}`
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalizeRfc8785(left) === canonicalizeRfc8785(right)
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

function sourceFingerprint(value: SessionSourceGenerationFileV1['fingerprint']): string {
  return canonicalizeRfc8785(value)
}

function currentSourceDescriptors(
  generation: SessionCacheGenerationV1,
): CanonicalHistoryPublicationSourceV1[] {
  return generation.providers.flatMap((provider: SessionSourceGenerationProviderV1) => provider.files.map(file => ({
    provider: provider.provider,
    pathSha256: file.pathSha256,
    envFingerprint: provider.envFingerprint,
    fingerprint: structuredClone(file.fingerprint),
    observationIds: [],
    activityIds: [],
  })))
}

function mapSources(sources: readonly CanonicalHistoryPublicationSourceV1[]): Map<SourceKey, CanonicalHistoryPublicationSourceV1> {
  const result = new Map<SourceKey, CanonicalHistoryPublicationSourceV1>()
  for (const source of sources) {
    const key = sourceKey(source.provider, source.pathSha256)
    if (result.has(key)) throw new CanonicalHistoryIncrementalProjectionUnavailableError('incremental source state contains duplicate source keys')
    result.set(key, source)
  }
  return result
}

function validateCoverage(
  previousProjection: CanonicalHistoryReadProjectionV1,
  previousSources: Map<SourceKey, CanonicalHistoryPublicationSourceV1>,
): void {
  const observations = new Set(previousProjection.observations.map(value => value.observationId))
  const activities = new Set(previousProjection.activities.map(value => value.activityId))
  const claimedObservations = new Set<string>()
  const claimedActivities = new Set<string>()
  for (const source of previousSources.values()) {
    for (const id of source.observationIds) {
      if (!observations.has(id)) throw new CanonicalHistoryIncrementalProjectionUnavailableError('incremental source state names a missing observation')
      claimedObservations.add(id)
    }
    for (const id of source.activityIds) {
      if (!activities.has(id)) throw new CanonicalHistoryIncrementalProjectionUnavailableError('incremental source state names a missing activity')
      claimedActivities.add(id)
    }
  }
  if (claimedObservations.size !== observations.size || [...observations].some(id => !claimedObservations.has(id))) {
    throw new CanonicalHistoryIncrementalProjectionUnavailableError('incremental source state does not cover the previous observations')
  }
  if (claimedActivities.size !== activities.size || [...activities].some(id => !claimedActivities.has(id))) {
    throw new CanonicalHistoryIncrementalProjectionUnavailableError('incremental source state does not cover the previous activities')
  }
}

function changedSources(
  previous: Map<SourceKey, CanonicalHistoryPublicationSourceV1>,
  current: Map<SourceKey, CanonicalHistoryPublicationSourceV1>,
): Set<SourceKey> {
  const changed = new Set<SourceKey>()
  for (const [key, source] of current) {
    const prior = previous.get(key)
    if (!prior || prior.envFingerprint !== source.envFingerprint || sourceFingerprint(prior.fingerprint) !== sourceFingerprint(source.fingerprint)) {
      changed.add(key)
    }
  }
  for (const key of previous.keys()) if (!current.has(key)) changed.add(key)

  const providers = new Set([...previous.values(), ...current.values()].map(source => source.provider))
  for (const provider of providers) {
    const priorEnv = [...previous.values()].find(source => source.provider === provider)?.envFingerprint
    const currentEnv = [...current.values()].find(source => source.provider === provider)?.envFingerprint
    if (priorEnv !== currentEnv) {
      for (const [key, source] of previous) if (source.provider === provider) changed.add(key)
      for (const [key, source] of current) if (source.provider === provider) changed.add(key)
    }
  }

  // Claude native reconciliation can select a different winner in an
  // unchanged file when any Claude source changes. Re-evaluate that provider
  // as one bounded reconciliation domain.
  if ([...changed].some(key => (previous.get(key) ?? current.get(key))?.provider === 'claude')) {
    for (const [key, source] of previous) if (source.provider === 'claude') changed.add(key)
    for (const [key, source] of current) if (source.provider === 'claude') changed.add(key)
  }
  let expanded = true
  while (expanded) {
    expanded = false
    const affectedObservationIds = new Set<string>()
    const affectedActivityIds = new Set<string>()
    for (const key of changed) {
      previous.get(key)?.observationIds.forEach(id => affectedObservationIds.add(id))
      previous.get(key)?.activityIds.forEach(id => affectedActivityIds.add(id))
      current.get(key)?.observationIds.forEach(id => affectedObservationIds.add(id))
      current.get(key)?.activityIds.forEach(id => affectedActivityIds.add(id))
    }
    for (const [key, source] of [...previous, ...current]) {
      if (changed.has(key)) continue
      if (
        source.observationIds.some(id => affectedObservationIds.has(id))
        || source.activityIds.some(id => affectedActivityIds.has(id))
      ) {
        changed.add(key)
        expanded = true
      }
    }
  }
  return changed
}

function sourceProjectionMap(
  sources: readonly CanonicalHistoryReadProjectionSourceV1[],
): Map<SourceKey, CanonicalHistoryReadProjectionSourceV1> {
  return new Map(sources.map(source => [sourceKey(source.provider, source.pathSha256), source]))
}

function mergeEntities<T>(
  previous: readonly T[],
  delta: readonly T[],
  keepIds: ReadonlySet<string>,
  idOf: (value: T) => string,
): T[] {
  const merged = new Map<string, T>()
  for (const value of previous) {
    const id = idOf(value)
    if (keepIds.has(id)) merged.set(id, value)
  }
  for (const value of delta) {
    const id = idOf(value)
    const prior = merged.get(id)
    if (prior && !sameValue(prior, value)) {
      throw new CanonicalHistoryIncrementalProjectionUnavailableError('canonical entity changed across an incremental source boundary')
    }
    merged.set(id, prior ?? value)
  }
  return [...merged.values()].sort((left, right) => idOf(left).localeCompare(idOf(right)))
}

function buildSources(
  current: Map<SourceKey, CanonicalHistoryPublicationSourceV1>,
  previous: Map<SourceKey, CanonicalHistoryPublicationSourceV1>,
  changed: ReadonlySet<SourceKey>,
  delta: Map<SourceKey, CanonicalHistoryReadProjectionSourceV1>,
): CanonicalHistoryPublicationSourceV1[] {
  return [...current.entries()]
    .map(([key, source]) => {
      const ids = changed.has(key) ? delta.get(key) : previous.get(key)
      return {
        ...source,
        observationIds: [...(ids?.observationIds ?? [])].sort(),
        activityIds: [...(ids?.activityIds ?? [])].sort(),
      }
    })
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.pathSha256.localeCompare(right.pathSha256))
}

export function projectCanonicalHistoryIncrementalV1(input: {
  endpointId: string
  sessionCache: SessionCache
  dailyCache: DailyCache
  sessionGeneration: SessionCacheGenerationV1
  previousProjection: CanonicalHistoryReadProjectionV1
  previousState: CanonicalHistoryPublicationStateV1
}): CanonicalHistoryIncrementalProjectionResultV1 {
  if (input.sessionGeneration.sourceManifestSha256 === input.previousState.sourceManifestSha256
    && input.sessionGeneration.payloadSha256 !== input.previousState.sessionPayloadSha256) {
    throw new CanonicalHistoryIncrementalProjectionUnavailableError('session payload changed without a changed source manifest')
  }

  const previous = mapSources(input.previousState.sources)
  validateCoverage(input.previousProjection, previous)
  const current = mapSources(currentSourceDescriptors(input.sessionGeneration))
  const changed = changedSources(previous, current)
  const delta = projectCanonicalHistoryReadWithSourcesV1(
    { endpointId: input.endpointId, sessionCache: input.sessionCache, dailyCache: input.dailyCache } satisfies CanonicalHistoryReadProjectionInputV1,
    { sourceKeys: changed },
  )
  const deltaSources = sourceProjectionMap(delta.sources)

  const preservedObservationIds = new Set<string>()
  const preservedActivityIds = new Set<string>()
  for (const [key, source] of previous) {
    if (changed.has(key) || !current.has(key)) continue
    source.observationIds.forEach(id => preservedObservationIds.add(id))
    source.activityIds.forEach(id => preservedActivityIds.add(id))
  }
  const observations = mergeEntities(input.previousProjection.observations, delta.projection.observations, preservedObservationIds, value => value.observationId)
  const activities = mergeEntities(input.previousProjection.activities, delta.projection.activities, preservedActivityIds, value => value.activityId)
  const observationIds = new Set(observations.map(value => value.observationId))
  for (const activity of activities) {
    if (activity.observationIds.some(id => !observationIds.has(id))) {
      throw new CanonicalHistoryIncrementalProjectionUnavailableError('incremental activity delta references a missing observation')
    }
  }

  const projection: CanonicalHistoryReadProjectionV1 = {
    version: delta.projection.version,
    authority: delta.projection.authority,
    observations,
    activities,
    dailySnapshots: delta.projection.dailySnapshots,
  }
  return {
    projection: deepFreeze(projection),
    sources: buildSources(current, previous, changed, deltaSources),
    changedSourceCount: changed.size,
    changedSourceKeys: [...changed].sort(),
  }
}
