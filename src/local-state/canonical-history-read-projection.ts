import { createHash } from 'node:crypto'

import { OpaqueIdSchema, TimestampSchema } from '../contracts/v1/common.js'
import { DAILY_CACHE_VERSION, type DailyCache, type DailyEntry, type ProjectDayStats, type ProviderDaySlice } from '../daily-cache.js'
import {
  CostAssignmentV1Schema,
  costAssignmentMatchesUsdV1,
  type CostAssignmentV1,
} from '../pricing/cost-assignment.js'
import {
  assertClaudeNativeReconciliationSafe,
  isClaudeNativeReconciliationWinner,
  reconcileClaudeNativeSessionCache,
} from '../claude-native-reconciliation.js'
import {
  CACHE_VERSION,
  type CachedCall,
  type CachedUsage,
  type SessionCache,
} from '../session-cache.js'
import { assertCanonicalCollectorIdentity } from '../provider-parse-authorities.js'
import { canonicalSourceRecordFingerprintSha256V1 } from './canonical-reviewed-production-scanner.js'

export const CANONICAL_HISTORY_READ_PROJECTION_VERSION = 1 as const

export type CanonicalObservationReadV1 = {
  observationId: string
  activityId: string
  sourceFingerprintSha256: string
  collector: string
  timestamp: string
  model: string
  modelProvider?: string
  usage: CachedUsage
  costUSD: number | null
  costAssignment: CostAssignmentV1
  legacyCostUSD?: number
  isEstimated: boolean
  speed: 'standard' | 'fast'
}

export type CanonicalActivityReadV1 = {
  activityId: string
  collector: string
  timestamp: string
  observationIds: string[]
}

type PathFreeProjectDayStats = Omit<ProjectDayStats, 'path'>
type PathFreeProviderDaySlice = Omit<ProviderDaySlice, 'projects'> & {
  projects?: Record<string, PathFreeProjectDayStats>
}

export type CanonicalHistoryDaySnapshotV1 = Omit<DailyEntry, 'providers' | 'projects'> & {
  snapshotId: string
  bucketTimeZone: string | null
  authority: 'trusted-daily-cache'
  providers: Record<string, PathFreeProviderDaySlice>
  projects?: Record<string, PathFreeProjectDayStats>
}

export type CanonicalHistoryReadProjectionV1 = {
  version: typeof CANONICAL_HISTORY_READ_PROJECTION_VERSION
  authority: {
    observations: 'shadow-session-cache'
    activities: 'shadow-session-cache'
    totals: 'trusted-daily-cache'
    additiveAcrossAuthorities: false
  }
  observations: CanonicalObservationReadV1[]
  activities: CanonicalActivityReadV1[]
  dailySnapshots: CanonicalHistoryDaySnapshotV1[]
}

export type CanonicalHistoryReadProjectionInputV1 = {
  endpointId: string
  sessionCache: SessionCache
  dailyCache: DailyCache
}

export class CanonicalHistoryReadProjectionIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalHistoryReadProjectionIntegrityError'
  }
}

function sha256Domain(domain: string, parts: readonly string[]): string {
  const hash = createHash('sha256').update(domain).update('\0')
  for (const part of parts) hash.update(part).update('\0')
  return hash.digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalHistoryReadProjectionIntegrityError('canonical history accepts only finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  throw new CanonicalHistoryReadProjectionIntegrityError('canonical history cannot encode this value')
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

function sortedRecord<T, R>(
  input: Record<string, T> | undefined,
  project: (value: T) => R,
): Record<string, R> | undefined {
  if (!input) return undefined
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, project(value)]))
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

function projectDailySnapshot(day: DailyEntry, bucketTimeZone: string | null): CanonicalHistoryDaySnapshotV1 {
  const withoutId = {
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
    models: Object.fromEntries(Object.entries(day.models).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, structuredClone(value)])),
    categories: Object.fromEntries(Object.entries(day.categories).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, structuredClone(value)])),
    providers: sortedRecord(day.providers, pathFreeProvider) ?? {},
    ...(day.projects !== undefined ? { projects: sortedRecord(day.projects, pathFreeProject) } : {}),
    ...(day.carried === true ? { carried: true as const } : {}),
    bucketTimeZone,
    authority: 'trusted-daily-cache' as const,
  }
  return {
    snapshotId: `history-day-v1:${sha256Domain('metrora-canonical-history-day-v1', [stableJson(withoutId)])}`,
    ...withoutId,
  }
}

function validatedCost(call: CachedCall): Pick<CanonicalObservationReadV1, 'costUSD' | 'costAssignment' | 'legacyCostUSD'> {
  if (!call.costAssignment) {
    throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached call has no immutable cost assignment')
  }
  const assignment = CostAssignmentV1Schema.parse(call.costAssignment)
  if (assignment.kind === 'unavailable') {
    if (call.costUSD !== undefined) {
      throw new CanonicalHistoryReadProjectionIntegrityError('unavailable cost assignment cannot carry a numeric canonical cost')
    }
    return {
      costUSD: null,
      costAssignment: structuredClone(assignment),
      ...(call.legacyCostUSD !== undefined ? { legacyCostUSD: call.legacyCostUSD } : {}),
    }
  }
  if (call.costUSD === undefined || !costAssignmentMatchesUsdV1(assignment, call.costUSD)) {
    throw new CanonicalHistoryReadProjectionIntegrityError('canonical cost assignment disagrees with cached cost')
  }
  return {
    costUSD: call.costUSD,
    costAssignment: structuredClone(assignment),
    ...(call.legacyCostUSD !== undefined ? { legacyCostUSD: call.legacyCostUSD } : {}),
  }
}

function observationForCall(input: {
  endpointId: string
  storageNamespace: string
  activityId: string
  call: CachedCall
}): CanonicalObservationReadV1 {
  const timestamp = TimestampSchema.safeParse(input.call.timestamp)
  if (!timestamp.success) throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached call has an invalid timestamp')
  let collector: string
  try {
    collector = assertCanonicalCollectorIdentity({
      storageNamespace: input.storageNamespace,
      callProvider: input.call.provider,
    })
  } catch {
    throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached call provider disagrees with its storage namespace')
  }
  if (!input.call.deduplicationKey) {
    throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached call has an empty private deduplication key')
  }
  const sourceFingerprintSha256 = canonicalSourceRecordFingerprintSha256V1({
    endpointId: input.endpointId,
    provider: collector,
    privateDeduplicationKey: input.call.deduplicationKey,
  })
  return {
    observationId: `observation-v1:${sourceFingerprintSha256}`,
    activityId: input.activityId,
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

function sameValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right)
}

export function projectCanonicalHistoryReadV1(
  inputValue: CanonicalHistoryReadProjectionInputV1,
): CanonicalHistoryReadProjectionV1 {
  const endpointId = OpaqueIdSchema.parse(inputValue.endpointId)
  const { sessionCache, dailyCache } = inputValue

  if (sessionCache.version !== CACHE_VERSION || sessionCache.complete !== true) {
    throw new CanonicalHistoryReadProjectionIntegrityError('canonical history requires a complete current-version session cache')
  }
  if (
    dailyCache.version !== DAILY_CACHE_VERSION ||
    dailyCache.complete !== true ||
    dailyCache.watermarkTrusted !== true
  ) {
    throw new CanonicalHistoryReadProjectionIntegrityError('canonical history requires a trusted complete current-version daily cache')
  }

  const observationsById = new Map<string, CanonicalObservationReadV1>()
  const activitiesById = new Map<string, CanonicalActivityReadV1>()
  const activityByObservation = new Map<string, string>()
  const claudeNativeReconciliation = reconcileClaudeNativeSessionCache(sessionCache)
  assertClaudeNativeReconciliationSafe(claudeNativeReconciliation)

  for (const [storageNamespace, section] of Object.entries(sessionCache.providers).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [, file] of Object.entries(section.files).sort(([a], [b]) => a.localeCompare(b))) {
      if (file.failed) continue
      for (const turn of file.turns) {
        if (!turn.sessionId) throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached turn has an empty private session id')
        const turnTimestamp = TimestampSchema.safeParse(turn.timestamp)
        if (!turnTimestamp.success) throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached turn has an invalid timestamp')
        const calls = storageNamespace === 'claude'
          ? turn.calls.filter(call => isClaudeNativeReconciliationWinner(call, claudeNativeReconciliation))
          : turn.calls
        if (calls.length === 0) continue

        const firstCall = calls[0]!
        if (!firstCall.deduplicationKey) {
          throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached call has an empty private deduplication key')
        }
        let collector: string
        try {
          collector = assertCanonicalCollectorIdentity({
            storageNamespace,
            callProvider: firstCall.provider,
          })
        } catch {
          throw new CanonicalHistoryReadProjectionIntegrityError('canonical cached call provider disagrees with its storage namespace')
        }
        const firstFingerprint = canonicalSourceRecordFingerprintSha256V1({
          endpointId,
          provider: collector,
          privateDeduplicationKey: firstCall.deduplicationKey,
        })
        const activityId = `activity-v1:${sha256Domain('metrora-canonical-activity-v1', [
          endpointId,
          collector,
          turn.sessionId,
          turnTimestamp.data,
          firstFingerprint,
        ])}`

        const observationIds: string[] = []
        for (const call of calls) {
          const observation = observationForCall({ endpointId, storageNamespace, activityId, call })
          const prior = observationsById.get(observation.observationId)
          if (prior && !sameValue(prior, observation)) {
            throw new CanonicalHistoryReadProjectionIntegrityError('one canonical source identity resolved to conflicting observations')
          }
          const priorActivity = activityByObservation.get(observation.observationId)
          if (priorActivity && priorActivity !== activityId) {
            throw new CanonicalHistoryReadProjectionIntegrityError('one canonical observation resolved to conflicting activities')
          }
          observationsById.set(observation.observationId, prior ?? observation)
          activityByObservation.set(observation.observationId, activityId)
          if (!observationIds.includes(observation.observationId)) observationIds.push(observation.observationId)
        }

        const activity: CanonicalActivityReadV1 = {
          activityId,
          collector,
          timestamp: turnTimestamp.data,
          observationIds,
        }
        const priorActivity = activitiesById.get(activityId)
        if (priorActivity && !sameValue(priorActivity, activity)) {
          throw new CanonicalHistoryReadProjectionIntegrityError('one canonical activity identity resolved to conflicting observations')
        }
        activitiesById.set(activityId, priorActivity ?? activity)
      }
    }
  }

  const projection: CanonicalHistoryReadProjectionV1 = {
    version: CANONICAL_HISTORY_READ_PROJECTION_VERSION,
    authority: {
      observations: 'shadow-session-cache',
      activities: 'shadow-session-cache',
      totals: 'trusted-daily-cache',
      additiveAcrossAuthorities: false,
    },
    observations: [...observationsById.values()].sort((a, b) => a.observationId.localeCompare(b.observationId)),
    activities: [...activitiesById.values()].sort((a, b) => a.activityId.localeCompare(b.activityId)),
    dailySnapshots: dailyCache.days
      .map(day => projectDailySnapshot(day, dailyCache.tzKey ?? null))
      .sort((a, b) => a.date.localeCompare(b.date) || a.snapshotId.localeCompare(b.snapshotId)),
  }
  return deepFreeze(projection)
}
