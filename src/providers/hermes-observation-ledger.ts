import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'

import { atomicWritePrivateFile, cleanupStaleAtomicTemps, ensurePrivateDirectory, readOptionalPrivateFile } from '../local-state/atomic-file.js'
import { withLocalStateLease } from '../local-state/local-state-lease.js'
import { getMetroraCacheDir } from '../product-paths.js'

export const HERMES_OBSERVATION_LEDGER_KIND = 'metrora.hermes-observation-ledger' as const
export const HERMES_OBSERVATION_LEDGER_VERSION = 1 as const
const MAX_SESSIONS = 4096
const MAX_OBSERVATIONS_PER_SESSION = 2048

const NonNegativeNumber = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER)
const SnapshotSchema = z.strictObject({
  inputTokens: NonNegativeNumber,
  outputTokens: NonNegativeNumber,
  cacheReadTokens: NonNegativeNumber,
  cacheWriteTokens: NonNegativeNumber,
  reasoningTokens: NonNegativeNumber,
  apiCalls: NonNegativeNumber,
  toolCalls: NonNegativeNumber,
  actualCostUSD: NonNegativeNumber.nullable(),
  estimatedCostUSD: NonNegativeNumber.nullable(),
  calculatedCostUSD: NonNegativeNumber,
})
const DeltaSchema = z.strictObject({
  inputTokens: NonNegativeNumber,
  outputTokens: NonNegativeNumber,
  cacheReadTokens: NonNegativeNumber,
  cacheWriteTokens: NonNegativeNumber,
  reasoningTokens: NonNegativeNumber,
  apiCalls: NonNegativeNumber,
  toolCalls: NonNegativeNumber,
  costUSD: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
})
const ObservationSchema = z.strictObject({
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observedAt: z.string().datetime({ offset: true }),
  timestamp: z.string().datetime({ offset: true }),
  costBasis: z.enum(['actual', 'estimated', 'calculated']),
  costTransition: z.enum(['none', 'to-actual', 'from-actual', 'actual-correction']),
  snapshot: SnapshotSchema,
  delta: DeltaSchema,
})
const SessionSchema = z.strictObject({
  key: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  profile: z.string().trim().min(1).max(120),
  sessionId: z.string().trim().min(1).max(500),
  sourceSignature: z.string().trim().min(1).max(300),
  epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nextSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // Cost retained after old append-only observations are bounded out of the
  // in-memory history. This preserves the materialized baseline across trims.
  materializedCostUSD: NonNegativeNumber.default(0),
  lastSnapshot: SnapshotSchema.nullable(),
  observations: z.array(ObservationSchema).max(MAX_OBSERVATIONS_PER_SESSION),
})
const StateSchema = z.strictObject({ sessions: z.array(SessionSchema).max(MAX_SESSIONS) })
const FileSchema = z.strictObject({
  kind: z.literal(HERMES_OBSERVATION_LEDGER_KIND),
  version: z.literal(HERMES_OBSERVATION_LEDGER_VERSION),
  stateSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  state: StateSchema,
})

type Snapshot = z.infer<typeof SnapshotSchema>
type Delta = z.infer<typeof DeltaSchema>
type Observation = z.infer<typeof ObservationSchema>
type SessionState = z.infer<typeof SessionSchema>
type LedgerState = z.infer<typeof StateSchema>

export type HermesObservationInputV1 = {
  profile: string
  sourcePath: string
  sourceSignature: string
  sessionId: string
  observedAt: Date
  sessionStartedAt?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  apiCalls: number
  toolCalls: number
  actualCostUSD: number | null
  estimatedCostUSD: number | null
  calculatedCostUSD: number
  ledgerDir?: string
}

export type HermesObservationEmissionV1 = {
  sequence: number
  epoch: number
  observedAt: string
  timestamp: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  apiCalls: number
  toolCalls: number
  costUSD: number
  costBasis: Observation['costBasis']
  costTransition: Observation['costTransition']
}

export class HermesObservationLedgerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HermesObservationLedgerError'
  }
}

function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HermesObservationLedgerError('Hermes ledger accepts only finite numbers.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort()
    return '{' + keys.map(key => JSON.stringify(key) + ':' + stableJson(object[key])).join(',') + '}'
  }
  throw new HermesObservationLedgerError('Hermes ledger cannot encode this value.')
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function stateDigest(state: LedgerState): string {
  return 'sha256:' + sha256(stableJson(state))
}

function sessionKey(input: Pick<HermesObservationInputV1, 'profile' | 'sourcePath' | 'sessionId'>): string {
  return 'sha256:' + sha256(stableJson([input.profile, input.sourcePath, input.sessionId]))
}

function ledgerPaths(ledgerDir: string) {
  const root = join(ledgerDir, 'hermes', 'v1')
  return { root, file: join(root, 'observation-ledger.json') }
}

export function hermesObservationLedgerDirectoryV1(ledgerDir = getMetroraCacheDir()): string {
  return ledgerPaths(ledgerDir).root
}

export function hermesObservationLedgerFileV1(ledgerDir = getMetroraCacheDir()): string {
  return ledgerPaths(ledgerDir).file
}

function iso(value: Date): string {
  const result = value.toISOString()
  if (!Number.isFinite(Date.parse(result))) throw new HermesObservationLedgerError('Hermes observation time is invalid.')
  return result
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new HermesObservationLedgerError('Hermes counters must be finite and non-negative.')
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
}

function normalizeMoney(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0) throw new HermesObservationLedgerError('Hermes costs must be finite and non-negative.')
  return Math.min(value, Number.MAX_SAFE_INTEGER)
}

function snapshot(input: HermesObservationInputV1): Snapshot {
  return SnapshotSchema.parse({
    inputTokens: normalizeCount(input.inputTokens),
    outputTokens: normalizeCount(input.outputTokens),
    cacheReadTokens: normalizeCount(input.cacheReadTokens),
    cacheWriteTokens: normalizeCount(input.cacheWriteTokens),
    reasoningTokens: normalizeCount(input.reasoningTokens),
    apiCalls: normalizeCount(input.apiCalls),
    toolCalls: normalizeCount(input.toolCalls),
    actualCostUSD: normalizeMoney(input.actualCostUSD),
    estimatedCostUSD: normalizeMoney(input.estimatedCostUSD),
    calculatedCostUSD: normalizeMoney(input.calculatedCostUSD),
  })
}

function effectiveCost(value: Snapshot): { amount: number; basis: Observation['costBasis'] } {
  if (value.actualCostUSD !== null) return { amount: value.actualCostUSD, basis: 'actual' }
  if (value.estimatedCostUSD !== null) return { amount: value.estimatedCostUSD, basis: 'estimated' }
  return { amount: value.calculatedCostUSD, basis: 'calculated' }
}

function sameSnapshot(left: Snapshot | null, right: Snapshot): boolean {
  return left !== null && stableJson(left) === stableJson(right)
}

function counterShrank(previous: Snapshot, current: Snapshot): boolean {
  return current.inputTokens < previous.inputTokens
    || current.outputTokens < previous.outputTokens
    || current.cacheReadTokens < previous.cacheReadTokens
    || current.cacheWriteTokens < previous.cacheWriteTokens
    || current.reasoningTokens < previous.reasoningTokens
    || current.apiCalls < previous.apiCalls
    || current.toolCalls < previous.toolCalls
}

function positiveDelta(current: number, previous: number | null): number {
  if (previous === null) return current
  return Math.max(0, current - previous)
}

type CostDelta = {
  costUSD: number
  costTransition: Observation['costTransition']
  reclassifyPriorCosts: boolean
}

function materializedCost(session: SessionState): number {
  return session.materializedCostUSD + session.observations.reduce((sum, observation) => observation.epoch === session.epoch ? sum + observation.delta.costUSD : sum, 0)
}

function costDelta(current: Snapshot, previous: Snapshot | null, alreadyMaterialized: number): CostDelta {
  const currentCost = effectiveCost(current)
  if (!previous) return { costUSD: currentCost.amount, costTransition: 'none', reclassifyPriorCosts: false }

  const previousCost = effectiveCost(previous)
  if (currentCost.basis === 'actual' && previousCost.basis !== 'actual') {
    if (currentCost.amount < alreadyMaterialized) {
      return { costUSD: currentCost.amount - alreadyMaterialized, costTransition: 'actual-correction', reclassifyPriorCosts: false }
    }
    const delta = currentCost.amount - alreadyMaterialized
    return { costUSD: delta, costTransition: delta > 0 ? 'to-actual' : 'actual-correction', reclassifyPriorCosts: false }
  }

  if (currentCost.basis === 'actual' && previousCost.basis === 'actual') {
    if (currentCost.amount < alreadyMaterialized) {
      return { costUSD: currentCost.amount - alreadyMaterialized, costTransition: 'actual-correction', reclassifyPriorCosts: false }
    }
    const delta = currentCost.amount - alreadyMaterialized
    return {
      costUSD: delta,
      costTransition: currentCost.amount < alreadyMaterialized ? 'actual-correction' : 'none',
      reclassifyPriorCosts: false,
    }
  }

  if (currentCost.basis !== 'actual' && previousCost.basis === 'actual') {
    // A later loss of actual evidence is not allowed to add an estimate after
    // an authoritative actual observation. Keep the transition explicit and
    // fail closed for cost while token growth remains observable.
    return { costUSD: 0, costTransition: 'from-actual', reclassifyPriorCosts: false }
  }

  return {
    costUSD: Math.max(0, currentCost.amount - alreadyMaterialized),
    costTransition: 'none',
    reclassifyPriorCosts: false,
  }
}

function observationDelta(current: Snapshot, previous: Snapshot | null, alreadyMaterialized: number): { delta: Delta; cost: CostDelta } {
  const cost = costDelta(current, previous, alreadyMaterialized)
  return {
    cost,
    delta: {
      inputTokens: positiveDelta(current.inputTokens, previous?.inputTokens ?? null),
      outputTokens: positiveDelta(current.outputTokens, previous?.outputTokens ?? null),
      cacheReadTokens: positiveDelta(current.cacheReadTokens, previous?.cacheReadTokens ?? null),
      cacheWriteTokens: positiveDelta(current.cacheWriteTokens, previous?.cacheWriteTokens ?? null),
      reasoningTokens: positiveDelta(current.reasoningTokens, previous?.reasoningTokens ?? null),
      apiCalls: positiveDelta(current.apiCalls, previous?.apiCalls ?? null),
      toolCalls: positiveDelta(current.toolCalls, previous?.toolCalls ?? null),
      costUSD: cost.costUSD,
    },
  }
}
function hasUsage(delta: Delta): boolean {
  return delta.inputTokens > 0 || delta.outputTokens > 0 || delta.cacheReadTokens > 0
    || delta.cacheWriteTokens > 0 || delta.reasoningTokens > 0 || delta.apiCalls > 0
    || delta.toolCalls > 0 || delta.costUSD !== 0
}

function emissionFromObservation(observation: Observation): HermesObservationEmissionV1 {
  return {
    sequence: observation.sequence,
    epoch: observation.epoch,
    observedAt: observation.observedAt,
    timestamp: observation.timestamp,
    inputTokens: observation.delta.inputTokens,
    outputTokens: observation.delta.outputTokens,
    cacheReadTokens: observation.delta.cacheReadTokens,
    cacheWriteTokens: observation.delta.cacheWriteTokens,
    reasoningTokens: observation.delta.reasoningTokens,
    apiCalls: observation.delta.apiCalls,
    toolCalls: observation.delta.toolCalls,
    costUSD: observation.delta.costUSD,
    costBasis: observation.costBasis,
    costTransition: observation.costTransition,
  }
}

function readState(bytes: Buffer): LedgerState {
  try {
    const wrapper = FileSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (wrapper.stateSha256 !== stateDigest(wrapper.state)) throw new HermesObservationLedgerError('Hermes ledger digest mismatch.')
    return wrapper.state
  } catch (error) {
    if (error instanceof HermesObservationLedgerError) throw error
    throw new HermesObservationLedgerError('Hermes observation ledger is corrupt.')
  }
}

async function loadState(file: string): Promise<LedgerState> {
  const bytes = await readOptionalPrivateFile(file)
  return bytes ? readState(bytes) : { sessions: [] }
}

function encodeState(state: LedgerState): string {
  const safe = StateSchema.parse(state)
  return JSON.stringify({
    kind: HERMES_OBSERVATION_LEDGER_KIND,
    version: HERMES_OBSERVATION_LEDGER_VERSION,
    stateSha256: stateDigest(safe),
    state: safe,
  })
}

function observationTimestamp(input: HermesObservationInputV1, first: boolean, observedAt: string): string {
  if (!first || !input.sessionStartedAt) return observedAt
  const started = Date.parse(input.sessionStartedAt)
  const observed = Date.parse(observedAt)
  return Number.isFinite(started) && started <= observed ? new Date(started).toISOString() : observedAt
}

function trimSessions(state: LedgerState): void {
  if (state.sessions.length <= MAX_SESSIONS) return
  state.sessions.splice(0, state.sessions.length - MAX_SESSIONS)
}

function trimObservations(session: SessionState): void {
  if (session.observations.length <= MAX_OBSERVATIONS_PER_SESSION) return
  const removeCount = session.observations.length - MAX_OBSERVATIONS_PER_SESSION
  const removed = session.observations.splice(0, removeCount)
  session.materializedCostUSD = Math.max(0, session.materializedCostUSD + removed.reduce(
    (sum, observation) => observation.epoch === session.epoch ? sum + observation.delta.costUSD : sum,
    0,
  ))
}

export async function observeHermesSessionV1(input: HermesObservationInputV1): Promise<HermesObservationEmissionV1[]> {
  const ledgerDir = input.ledgerDir ?? getMetroraCacheDir()
  const paths = ledgerPaths(ledgerDir)
  await ensurePrivateDirectory(paths.root)
  await cleanupStaleAtomicTemps(paths.root)
  const observedAt = iso(input.observedAt)
  const current = snapshot(input)
  const key = sessionKey(input)

  return withLocalStateLease(paths.root, async () => {
    const state = await loadState(paths.file)
    let session = state.sessions.find(item => item.key === key)
    if (!session) {
      session = {
        key,
        profile: input.profile.trim().slice(0, 120) || 'default',
        sessionId: input.sessionId.trim().slice(0, 500),
        sourceSignature: input.sourceSignature.trim().slice(0, 300) || 'unknown',
        epoch: 1,
        nextSequence: 1,
        materializedCostUSD: 0,
        lastSnapshot: null,
        observations: [],
      }
      state.sessions.push(session)
    }

    if (session.sourceSignature !== input.sourceSignature || (session.lastSnapshot && counterShrank(session.lastSnapshot, current))) {
      session.sourceSignature = input.sourceSignature.trim().slice(0, 300) || 'unknown'
      session.epoch += 1
      session.materializedCostUSD = 0
      session.lastSnapshot = null
    }

if (!sameSnapshot(session.lastSnapshot, current)) {
      const previous = session.lastSnapshot
      const alreadyMaterialized = materializedCost(session)
      const calculated = observationDelta(current, previous, alreadyMaterialized)
      const effective = effectiveCost(current)
      const previousEffective = previous ? effectiveCost(previous) : null
      const hasCounters = current.inputTokens + current.outputTokens + current.cacheReadTokens + current.cacheWriteTokens + current.reasoningTokens + current.apiCalls + current.toolCalls > 0
      const explicitCostEvidence = (current.actualCostUSD !== null || current.estimatedCostUSD !== null) && (hasCounters || effective.amount > 0)
      const costChanged = previous === null
        ? explicitCostEvidence
        : previousEffective?.basis !== effective.basis || previousEffective.amount !== effective.amount
      const shouldPublish = hasUsage(calculated.delta) || calculated.cost.costTransition !== 'none' || costChanged
      const sequence = session.nextSequence
      session.nextSequence += 1
      if (shouldPublish) {
        const observation = ObservationSchema.parse({
          sequence,
          epoch: session.epoch,
          observedAt,
          timestamp: observationTimestamp(input, previous === null, observedAt),
          costBasis: effective.basis,
          costTransition: previous === null ? 'none' : calculated.cost.costTransition,
          snapshot: current,
          delta: calculated.delta,
        })
        session.observations.push(observation)
        trimObservations(session)
      }
      session.lastSnapshot = current
      trimSessions(state)
      await atomicWritePrivateFile(paths.file, encodeState(state))
    }
    return session.observations.map(emissionFromObservation)
  })
}

export async function readHermesObservationLedgerV1(ledgerDir = getMetroraCacheDir()): Promise<unknown> {
  const paths = ledgerPaths(ledgerDir)
  const bytes = await readOptionalPrivateFile(paths.file)
  if (!bytes) {
    const state: LedgerState = { sessions: [] }
    return { kind: HERMES_OBSERVATION_LEDGER_KIND, version: HERMES_OBSERVATION_LEDGER_VERSION, stateSha256: stateDigest(state), state }
  }
  try {
    const wrapper = FileSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (wrapper.stateSha256 !== stateDigest(wrapper.state)) throw new HermesObservationLedgerError('Hermes ledger digest mismatch.')
    return wrapper
  } catch (error) {
    if (error instanceof HermesObservationLedgerError) throw error
    throw new HermesObservationLedgerError('Hermes observation ledger is corrupt.')
  }
}