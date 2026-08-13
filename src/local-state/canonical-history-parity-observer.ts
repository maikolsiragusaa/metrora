import { TimestampSchema } from '../contracts/v1/common.js'
import {
  DAILY_CACHE_VERSION,
  type DailyCache,
  type DailyEntry,
  type ProjectDayStats,
  type ProviderDaySlice,
} from '../daily-cache.js'
import {
  CostAssignmentV1Schema,
  costAssignmentMatchesUsdV1,
  type CostAssignmentV1,
} from '../pricing/cost-assignment.js'
import { assertCanonicalCollectorIdentity } from '../provider-parse-authorities.js'
import {
  assertClaudeNativeReconciliationSafe,
  isClaudeNativeReconciliationWinner,
  reconcileClaudeNativeSessionCache,
} from '../claude-native-reconciliation.js'
import { CACHE_VERSION, type CachedCall, type SessionCache } from '../session-cache.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import {
  projectCanonicalHistoryReadV1,
  type CanonicalActivityReadV1,
  type CanonicalHistoryReadProjectionInputV1,
  type CanonicalHistoryReadProjectionV1,
  type CanonicalObservationReadV1,
} from './canonical-history-read-projection.js'
import {
  persistCanonicalHistoryShadowV1,
  type PersistCanonicalHistoryShadowResultV1,
} from './canonical-history-shadow-store.js'

export const CANONICAL_HISTORY_PARITY_OBSERVER_VERSION = 1 as const

export type CanonicalHistoryParityCountsV1 = {
  observations: number
  activities: number
  dailySnapshots: number
}

export type CanonicalHistoryParityObservationV1 = {
  kind: 'metrora.canonical-history-parity-observation'
  version: typeof CANONICAL_HISTORY_PARITY_OBSERVER_VERSION
  outcome: 'matched'
  projectionSha256: string
  previousProjectionSha256?: string
  shadowStatus: PersistCanonicalHistoryShadowResultV1['status']
  counts: CanonicalHistoryParityCountsV1
  reconciliation: PersistCanonicalHistoryShadowResultV1['reconciliation']
  additiveAcrossAuthorities: false
}

export type CanonicalHistoryParityObserverDependenciesV1 = {
  sourceFingerprint(input: {
    endpointId: string
    provider: string
    privateDeduplicationKey: string
  }): string
  project?: (input: CanonicalHistoryReadProjectionInputV1) => CanonicalHistoryReadProjectionV1
  persist?: (
    projection: CanonicalHistoryReadProjectionV1,
  ) => Promise<PersistCanonicalHistoryShadowResultV1>
}

export class CanonicalHistoryParityMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalHistoryParityMismatchError'
  }
}

type ObservationPayload = Omit<CanonicalObservationReadV1, 'observationId' | 'activityId'>
type ActivityPayload = Omit<CanonicalActivityReadV1, 'activityId'>
type PathFreeProjectDayStats = Omit<ProjectDayStats, 'path'>
type PathFreeProviderDaySlice = Omit<ProviderDaySlice, 'projects'> & {
  projects?: Record<string, PathFreeProjectDayStats>
}
type DailySnapshotPayload = Omit<
  CanonicalHistoryReadProjectionV1['dailySnapshots'][number],
  'snapshotId'
>

function canonical(value: unknown): string {
  try {
    return canonicalizeRfc8785(value)
  } catch {
    throw new CanonicalHistoryParityMismatchError('canonical history parity encountered non-canonical JSON')
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right)
}

function sortedRecord<T, R>(
  input: Record<string, T> | undefined,
  project: (value: T) => R,
): Record<string, R> | undefined {
  if (!input) return undefined
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, project(value)]),
  )
}

function pathFreeProject(value: ProjectDayStats): PathFreeProjectDayStats {
  return {
    cost: value.cost,
    calls: value.calls,
    savingsUSD: value.savingsUSD,
    sessions: value.sessions,
  }
}

function pathFreeProvider(value: ProviderDaySlice): PathFreeProviderDaySlice {
  return {
    calls: value.calls,
    cost: value.cost,
    savingsUSD: value.savingsUSD,
    ...(value.sessions !== undefined ? { sessions: value.sessions } : {}),
    ...(value.inputTokens !== undefined ? { inputTokens: value.inputTokens } : {}),
    ...(value.outputTokens !== undefined ? { outputTokens: value.outputTokens } : {}),
    ...(value.cacheReadTokens !== undefined ? { cacheReadTokens: value.cacheReadTokens } : {}),
    ...(value.cacheWriteTokens !== undefined ? { cacheWriteTokens: value.cacheWriteTokens } : {}),
    ...(value.editTurns !== undefined ? { editTurns: value.editTurns } : {}),
    ...(value.oneShotTurns !== undefined ? { oneShotTurns: value.oneShotTurns } : {}),
    ...(value.models !== undefined ? { models: structuredClone(value.models) } : {}),
    ...(value.categories !== undefined ? { categories: structuredClone(value.categories) } : {}),
    ...(value.projects !== undefined ? { projects: sortedRecord(value.projects, pathFreeProject) } : {}),
  }
}

function rawDailyPayload(day: DailyEntry, bucketTimeZone: string | null): DailySnapshotPayload {
  return {
    date: day.date,
    cost: day.cost,
    savingsUSD: day.savingsUSD,
    calls: day.calls,
    sessions: day.sessions,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheWriteTokens: day.cacheWriteTokens,
    editTurns: day.editTurns,
    oneShotTurns: day.oneShotTurns,
    models: Object.fromEntries(
      Object.entries(day.models)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, structuredClone(value)]),
    ),
    categories: Object.fromEntries(
      Object.entries(day.categories)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, structuredClone(value)]),
    ),
    providers: sortedRecord(day.providers, pathFreeProvider) ?? {},
    ...(day.projects !== undefined ? { projects: sortedRecord(day.projects, pathFreeProject) } : {}),
    ...(day.carried === true ? { carried: true as const } : {}),
    bucketTimeZone,
    authority: 'trusted-daily-cache',
  }
}

function canonicalCollectorForCall(storageNamespace: string, callProvider: string): string {
  try {
    return assertCanonicalCollectorIdentity({ storageNamespace, callProvider })
  } catch {
    throw new CanonicalHistoryParityMismatchError(
      'canonical cached call provider disagrees with its storage namespace',
    )
  }
}

function validatedCost(call: CachedCall): Pick<
  ObservationPayload,
  'costUSD' | 'costAssignment' | 'legacyCostUSD'
> {
  if (!call.costAssignment) {
    throw new CanonicalHistoryParityMismatchError('canonical cached call has no immutable cost assignment')
  }
  const assignment = CostAssignmentV1Schema.parse(call.costAssignment) as CostAssignmentV1
  if (assignment.kind === 'unavailable') {
    if (call.costUSD !== undefined) {
      throw new CanonicalHistoryParityMismatchError(
        'unavailable cost assignment cannot carry a numeric canonical cost',
      )
    }
    return {
      costUSD: null,
      costAssignment: structuredClone(assignment),
      ...(call.legacyCostUSD !== undefined ? { legacyCostUSD: call.legacyCostUSD } : {}),
    }
  }
  if (call.costUSD === undefined || !costAssignmentMatchesUsdV1(assignment, call.costUSD)) {
    throw new CanonicalHistoryParityMismatchError(
      'canonical cost assignment disagrees with cached cost',
    )
  }
  return {
    costUSD: call.costUSD,
    costAssignment: structuredClone(assignment),
    ...(call.legacyCostUSD !== undefined ? { legacyCostUSD: call.legacyCostUSD } : {}),
  }
}

function rawObservationPayload(input: {
  endpointId: string
  storageNamespace: string
  call: CachedCall
  sourceFingerprint: CanonicalHistoryParityObserverDependenciesV1['sourceFingerprint']
}): ObservationPayload {
  const timestamp = TimestampSchema.safeParse(input.call.timestamp)
  if (!timestamp.success) {
    throw new CanonicalHistoryParityMismatchError('canonical cached call has an invalid timestamp')
  }
  const collector = canonicalCollectorForCall(input.storageNamespace, input.call.provider)
  if (!input.call.deduplicationKey) {
    throw new CanonicalHistoryParityMismatchError(
      'canonical cached call has an empty private deduplication key',
    )
  }
  const sourceFingerprintSha256 = input.sourceFingerprint({
    endpointId: input.endpointId,
    provider: collector,
    privateDeduplicationKey: input.call.deduplicationKey,
  })
  return {
    sourceFingerprintSha256,
    collector,
    timestamp: timestamp.data,
    model: input.call.model,
    ...(input.call.modelProvider !== undefined ? { modelProvider: input.call.modelProvider } : {}),
    usage: structuredClone(input.call.usage),
    ...validatedCost(input.call),
    isEstimated: input.call.isEstimated === true,
    speed: input.call.speed,
  }
}

function addUniquePayload<T>(
  target: Map<string, T>,
  id: string,
  payload: T,
  label: string,
): void {
  const previous = target.get(id)
  if (previous !== undefined && !sameValue(previous, payload)) {
    throw new CanonicalHistoryParityMismatchError(`${label} identity resolved to conflicting payloads`)
  }
  target.set(id, previous ?? payload)
}

function expectedSessionAuthority(input: {
  endpointId: string
  sessionCache: SessionCache
  sourceFingerprint: CanonicalHistoryParityObserverDependenciesV1['sourceFingerprint']
}): { observations: Map<string, ObservationPayload>; activities: Set<string> } {
  const observations = new Map<string, ObservationPayload>()
  const activities = new Set<string>()
  const observationActivity = new Map<string, string>()
  const claudeNativeReconciliation = reconcileClaudeNativeSessionCache(input.sessionCache)
  try {
    assertClaudeNativeReconciliationSafe(claudeNativeReconciliation)
  } catch {
    throw new CanonicalHistoryParityMismatchError('Claude native evidence cannot establish a canonical authority')
  }

  for (const [storageNamespace, section] of Object.entries(input.sessionCache.providers)
    .sort(([left], [right]) => left.localeCompare(right))) {
    for (const [, file] of Object.entries(section.files)
      .sort(([left], [right]) => left.localeCompare(right))) {
      if (file.failed) continue
      for (const turn of file.turns) {
        const calls = storageNamespace === 'claude'
          ? turn.calls.filter(call => isClaudeNativeReconciliationWinner(call, claudeNativeReconciliation))
          : turn.calls
        if (calls.length === 0) continue
        const timestamp = TimestampSchema.safeParse(turn.timestamp)
        if (!timestamp.success) {
          throw new CanonicalHistoryParityMismatchError('canonical cached turn has an invalid timestamp')
        }
        const collector = canonicalCollectorForCall(storageNamespace, calls[0]!.provider)
        const observationIds: string[] = []
        for (const call of calls) {
          const payload = rawObservationPayload({
            endpointId: input.endpointId,
            storageNamespace,
            call,
            sourceFingerprint: input.sourceFingerprint,
          })
          const observationId = `observation-v1:${payload.sourceFingerprintSha256}`
          addUniquePayload(observations, observationId, payload, 'observation')
          if (!observationIds.includes(observationId)) observationIds.push(observationId)
        }
        const activity: ActivityPayload = {
          collector,
          timestamp: timestamp.data,
          observationIds,
        }
        const activityKey = canonical(activity)
        for (const observationId of observationIds) {
          const previous = observationActivity.get(observationId)
          if (previous !== undefined && previous !== activityKey) {
            throw new CanonicalHistoryParityMismatchError(
              'one canonical observation belongs to conflicting activities',
            )
          }
          observationActivity.set(observationId, previous ?? activityKey)
        }
        activities.add(activityKey)
      }
    }
  }

  return { observations, activities }
}

function projectedSessionAuthority(
  projection: CanonicalHistoryReadProjectionV1,
): { observations: Map<string, ObservationPayload>; activities: Set<string> } {
  const observations = new Map<string, ObservationPayload>()
  for (const observation of projection.observations) {
    const { observationId, activityId: _activityId, ...payload } = observation
    addUniquePayload(observations, observationId, payload, 'projected observation')
  }

  const activities = new Set<string>()
  const referenced = new Map<string, string>()
  for (const activity of projection.activities) {
    const { activityId: _activityId, ...payload } = activity
    const key = canonical(payload)
    if (activities.has(key)) {
      throw new CanonicalHistoryParityMismatchError('projection contains duplicate activity payloads')
    }
    activities.add(key)
    for (const observationId of activity.observationIds) {
      if (!observations.has(observationId)) {
        throw new CanonicalHistoryParityMismatchError(
          'projection activity references a missing observation',
        )
      }
      const previous = referenced.get(observationId)
      if (previous !== undefined && previous !== key) {
        throw new CanonicalHistoryParityMismatchError(
          'projection observation is referenced by conflicting activities',
        )
      }
      referenced.set(observationId, previous ?? key)
    }
  }
  if (referenced.size !== observations.size) {
    throw new CanonicalHistoryParityMismatchError(
      'projection contains observations outside the activity partition',
    )
  }
  return { observations, activities }
}

function assertMapParity<T>(
  expected: Map<string, T>,
  actual: Map<string, T>,
  label: string,
): void {
  if (expected.size !== actual.size) {
    throw new CanonicalHistoryParityMismatchError(`${label} count does not match source authority`)
  }
  for (const [id, payload] of expected) {
    const projected = actual.get(id)
    if (projected === undefined || !sameValue(payload, projected)) {
      throw new CanonicalHistoryParityMismatchError(`${label} payload does not match source authority`)
    }
  }
}

function assertSetParity(expected: Set<string>, actual: Set<string>, label: string): void {
  if (expected.size !== actual.size || [...expected].some(value => !actual.has(value))) {
    throw new CanonicalHistoryParityMismatchError(`${label} partition does not match source authority`)
  }
}

function assertDailyParity(dailyCache: DailyCache, projection: CanonicalHistoryReadProjectionV1): void {
  const expected = dailyCache.days
    .map(day => rawDailyPayload(day, dailyCache.tzKey ?? null))
    .sort((left, right) => left.date.localeCompare(right.date) || canonical(left).localeCompare(canonical(right)))
  const actual = projection.dailySnapshots
    .map(({ snapshotId: _snapshotId, ...snapshot }) => snapshot)
    .sort((left, right) => left.date.localeCompare(right.date) || canonical(left).localeCompare(canonical(right)))
  if (!sameValue(expected, actual)) {
    throw new CanonicalHistoryParityMismatchError(
      'daily snapshot projection does not match trusted daily-cache authority',
    )
  }
}

export async function observeCanonicalHistoryParityV1(
  input: CanonicalHistoryReadProjectionInputV1,
  dependencies: CanonicalHistoryParityObserverDependenciesV1,
): Promise<CanonicalHistoryParityObservationV1> {
  if (input.sessionCache.version !== CACHE_VERSION || input.sessionCache.complete !== true) {
    throw new CanonicalHistoryParityMismatchError(
      'canonical history parity requires a complete current-version session cache',
    )
  }
  if (
    input.dailyCache.version !== DAILY_CACHE_VERSION
    || input.dailyCache.complete !== true
    || input.dailyCache.watermarkTrusted !== true
  ) {
    throw new CanonicalHistoryParityMismatchError(
      'canonical history parity requires a trusted complete current-version daily cache',
    )
  }

  const project = dependencies.project ?? projectCanonicalHistoryReadV1
  const persist = dependencies.persist ?? (projection => persistCanonicalHistoryShadowV1(projection))
  const projection = project(input)
  const expected = expectedSessionAuthority({
    endpointId: input.endpointId,
    sessionCache: input.sessionCache,
    sourceFingerprint: dependencies.sourceFingerprint,
  })
  const actual = projectedSessionAuthority(projection)

  assertMapParity(expected.observations, actual.observations, 'observation')
  assertSetParity(expected.activities, actual.activities, 'activity')
  assertDailyParity(input.dailyCache, projection)

  const persisted = await persist(projection)
  return {
    kind: 'metrora.canonical-history-parity-observation',
    version: CANONICAL_HISTORY_PARITY_OBSERVER_VERSION,
    outcome: 'matched',
    projectionSha256: persisted.projectionSha256,
    ...(persisted.previousProjectionSha256 !== undefined
      ? { previousProjectionSha256: persisted.previousProjectionSha256 }
      : {}),
    shadowStatus: persisted.status,
    counts: {
      observations: projection.observations.length,
      activities: projection.activities.length,
      dailySnapshots: projection.dailySnapshots.length,
    },
    reconciliation: persisted.reconciliation,
    additiveAcrossAuthorities: false,
  }
}
