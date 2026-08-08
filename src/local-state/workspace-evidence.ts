import { createHash, createPublicKey, verify } from 'node:crypto'
import * as z from 'zod/v4'

import {
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '../contracts/v1/common.js'
import { EndpointV1Schema } from '../contracts/v1/endpoint.js'
import {
  WorkspaceMembershipV1Schema,
  WorkspaceV1Schema,
} from '../contracts/v1/workspace.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import { atomicWritePrivateFile } from './atomic-file.js'
import {
  signWithLocalEndpointIdentityV1,
  type LoadedLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import {
  loadLocalPersonalWorkspaceV1,
  type LocalPersonalWorkspaceStateV1,
} from './local-workspace.js'
import { scanMeasurementOutboxV1 } from './measurement-outbox.js'
import {
  createNextSignedMeasurementBatchV1,
  listSignedMeasurementBatchStatesV1,
  LocalSignedMeasurementBatchV1Schema,
  verifyLocalSignedMeasurementBatchChainV1,
  type CreateSignedMeasurementBatchV1Options,
  type LocalSignedMeasurementBatchStateV1,
} from './signed-batch.js'

export const LOCAL_WORKSPACE_EVIDENCE_EXPORT_KIND = 'metrora.local-workspace-evidence-export' as const
export const LOCAL_WORKSPACE_EVIDENCE_PAYLOAD_KIND = 'metrora.local-workspace-evidence-payload' as const

const CanonicalBase64Schema = z.string().min(1).refine(value => {
  try { return Buffer.from(value, 'base64').toString('base64') === value } catch { return false }
}, 'must be canonical base64')

const ExportAcknowledgementV1Schema = z.strictObject({
  batchId: z.string().trim().min(1).max(240),
  batchSha256: Sha256DigestSchema,
  acceptedThroughSequence: PositiveIntegerSchema,
  acknowledgedAt: TimestampSchema,
})

const PendingExportBatchV1Schema = z.strictObject({
  state: z.literal('pending'),
  signed: LocalSignedMeasurementBatchV1Schema,
})

const AcknowledgedExportBatchV1Schema = z.strictObject({
  state: z.literal('acknowledged'),
  signed: LocalSignedMeasurementBatchV1Schema,
  acknowledgement: ExportAcknowledgementV1Schema,
})

export const LocalWorkspaceEvidenceExportBatchV1Schema = z.discriminatedUnion('state', [
  PendingExportBatchV1Schema,
  AcknowledgedExportBatchV1Schema,
])

const ExportSummaryV1Schema = z.strictObject({
  batchCount: NonNegativeIntegerSchema,
  eventCount: NonNegativeIntegerSchema,
  pendingBatchCount: NonNegativeIntegerSchema,
  acknowledgedBatchCount: NonNegativeIntegerSchema,
  firstSequence: PositiveIntegerSchema.optional(),
  lastSequence: PositiveIntegerSchema.optional(),
  latestBatchSha256: Sha256DigestSchema.optional(),
})

export const LocalWorkspaceEvidencePayloadV1Schema = z.strictObject({
  kind: z.literal(LOCAL_WORKSPACE_EVIDENCE_PAYLOAD_KIND),
  version: z.literal(1),
  exportedAt: TimestampSchema,
  workspace: WorkspaceV1Schema,
  ownerMembership: WorkspaceMembershipV1Schema,
  endpoint: EndpointV1Schema,
  endpointIdentityGeneration: PositiveIntegerSchema,
  summary: ExportSummaryV1Schema,
  batches: z.array(LocalWorkspaceEvidenceExportBatchV1Schema).max(10_000),
}).superRefine((payload, ctx) => {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message })
  }
  if (payload.workspace.ownership !== 'personal' || payload.workspace.status !== 'active') {
    issue(['workspace'], 'exported local workspace must be active and personal')
  }
  if (payload.ownerMembership.workspaceId !== payload.workspace.workspaceId) {
    issue(['ownerMembership', 'workspaceId'], 'exported owner membership belongs to another workspace')
  }
  if (payload.ownerMembership.role !== 'owner' || payload.ownerMembership.status !== 'active') {
    issue(['ownerMembership'], 'exported membership must be an active owner')
  }
  if (payload.endpoint.workspaceId !== payload.workspace.workspaceId) {
    issue(['endpoint', 'workspaceId'], 'exported endpoint belongs to another workspace')
  }
  if (payload.endpoint.enrollment.state !== 'active') {
    issue(['endpoint', 'enrollment'], 'exported endpoint must be actively enrolled')
  }
})

export const LocalWorkspaceEvidenceExportV1Schema = z.strictObject({
  kind: z.literal(LOCAL_WORKSPACE_EVIDENCE_EXPORT_KIND),
  version: z.literal(1),
  canonicalization: z.literal('RFC8785'),
  payloadSha256: Sha256DigestSchema,
  payload: LocalWorkspaceEvidencePayloadV1Schema,
  signature: z.strictObject({
    algorithm: z.literal('ed25519'),
    identityGeneration: PositiveIntegerSchema,
    publicKeySpkiBase64: CanonicalBase64Schema,
    publicKeyFingerprintSha256: Sha256DigestSchema,
    signatureBase64: CanonicalBase64Schema,
  }),
})

export type LocalWorkspaceEvidenceExportBatchV1 = z.infer<typeof LocalWorkspaceEvidenceExportBatchV1Schema>
export type LocalWorkspaceEvidencePayloadV1 = z.infer<typeof LocalWorkspaceEvidencePayloadV1Schema>
export type LocalWorkspaceEvidenceExportV1 = z.infer<typeof LocalWorkspaceEvidenceExportV1Schema>

export type LocalWorkspaceEvidenceStateKindV1 =
  | 'workspace-required'
  | 'empty'
  | 'ready'
  | 'acknowledged'
  | 'quarantined'
  | 'blocked'

export type LocalWorkspaceEvidenceStateV1 = {
  state: LocalWorkspaceEvidenceStateKindV1
  workspaceId?: string
  endpointId?: string
  pendingEventCount: number
  unbatchedEventCount: number
  acknowledgedEventCount: number
  invalidEventCount: number
  quarantinedEventCount: number
  pendingBatchCount: number
  acknowledgedBatchCount: number
  blockers: string[]
}

export type InspectLocalWorkspaceEvidenceV1Options = {
  identity: LoadedLocalEndpointIdentityV1
  dataDir: string
  now?: () => Date
}

export type CreateNextLocalWorkspaceSignedBatchV1Options = InspectLocalWorkspaceEvidenceV1Options & Omit<
  CreateSignedMeasurementBatchV1Options,
  'dataDir' | 'identity' | 'workspaceId'
>

export type CreateLocalWorkspaceEvidenceExportV1Options = InspectLocalWorkspaceEvidenceV1Options & {
  outputPath?: string
  now?: () => Date
}

export type VerifiedLocalWorkspaceEvidenceExportV1 = {
  workspaceId: string
  endpointId: string
  endpointIdentityGeneration: number
  exportedAt: string
  batchCount: number
  eventCount: number
  pendingBatchCount: number
  acknowledgedBatchCount: number
  latestBatchSha256?: string
}

export class LocalWorkspaceEvidenceBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalWorkspaceEvidenceBlockedError'
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalPayload(payload: LocalWorkspaceEvidencePayloadV1): string {
  return canonicalizeRfc8785(LocalWorkspaceEvidencePayloadV1Schema.parse(payload))
}

function exportBatchStates(states: LocalSignedMeasurementBatchStateV1[]): LocalWorkspaceEvidenceExportBatchV1[] {
  return states.map(({ signed, acknowledgement }) => acknowledgement
    ? LocalWorkspaceEvidenceExportBatchV1Schema.parse({
        state: 'acknowledged',
        signed,
        acknowledgement: {
          batchId: acknowledgement.batchId,
          batchSha256: acknowledgement.batchSha256,
          acceptedThroughSequence: acknowledgement.acceptedThroughSequence,
          acknowledgedAt: acknowledgement.acknowledgedAt,
        },
      })
    : LocalWorkspaceEvidenceExportBatchV1Schema.parse({ state: 'pending', signed }))
}

function summaryFor(batches: LocalWorkspaceEvidenceExportBatchV1[]) {
  const signed = batches.map(item => item.signed)
  const eventCount = signed.reduce((sum, item) => sum + item.range.eventCount, 0)
  const acknowledgedBatchCount = batches.filter(item => item.state === 'acknowledged').length
  const first = signed[0]
  const last = signed.at(-1)
  return ExportSummaryV1Schema.parse({
    batchCount: signed.length,
    eventCount,
    pendingBatchCount: signed.length - acknowledgedBatchCount,
    acknowledgedBatchCount,
    ...(first ? { firstSequence: first.range.firstSequence } : {}),
    ...(last ? {
      lastSequence: last.range.lastSequence,
      latestBatchSha256: last.batchSha256,
    } : {}),
  })
}

async function loadWorkspace(
  options: InspectLocalWorkspaceEvidenceV1Options,
): Promise<LocalPersonalWorkspaceStateV1 | undefined> {
  return loadLocalPersonalWorkspaceV1({
    endpointIdentity: options.identity.metadata,
    dataDir: options.dataDir,
    ...(options.now ? { now: options.now } : {}),
  })
}

function recordIsAuthorized(
  workspace: LocalPersonalWorkspaceStateV1,
  record: { event: { data: { workspaceId: string; endpointId: string } } },
): boolean {
  return record.event.data.workspaceId === workspace.workspace.workspaceId
    && record.event.data.endpointId === workspace.endpoint.endpointId
}

export async function inspectLocalWorkspaceEvidenceV1(
  options: InspectLocalWorkspaceEvidenceV1Options,
): Promise<LocalWorkspaceEvidenceStateV1> {
  const workspace = await loadWorkspace(options)
  if (!workspace) {
    return {
      state: 'workspace-required',
      pendingEventCount: 0,
      unbatchedEventCount: 0,
      acknowledgedEventCount: 0,
      invalidEventCount: 0,
      quarantinedEventCount: 0,
      pendingBatchCount: 0,
      acknowledgedBatchCount: 0,
      blockers: ['local personal workspace is not configured'],
    }
  }

  const scan = await scanMeasurementOutboxV1({ dataDir: options.dataDir })
  let batchStates: LocalSignedMeasurementBatchStateV1[] = []
  const blockers: string[] = []
  try {
    batchStates = await listSignedMeasurementBatchStatesV1({
      dataDir: options.dataDir,
      endpointId: workspace.endpoint.endpointId,
      workspaceId: workspace.workspace.workspaceId,
    })
  } catch (error) {
    blockers.push(`signed batch state is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (scan.invalid.length) blockers.push(`${scan.invalid.length} invalid outbox event(s) require recovery`)
  const visibleRecords = [
    ...scan.pending,
    ...scan.acknowledged.map(item => item.record),
  ]
  const foreignRecords = visibleRecords.filter(record => !recordIsAuthorized(workspace, record))
  if (foreignRecords.length) blockers.push(`${foreignRecords.length} outbox event(s) are outside the local workspace endpoint`)

  const latestSequence = batchStates.at(-1)?.signed.range.lastSequence ?? 0
  const unbatchedEventCount = scan.pending.filter(record => record.sequence > latestSequence).length
  const pendingBatchCount = batchStates.filter(item => item.acknowledgement === undefined).length
  const acknowledgedBatchCount = batchStates.length - pendingBatchCount

  let state: LocalWorkspaceEvidenceStateKindV1
  if (blockers.length) state = 'blocked'
  else if (scan.quarantined.length) state = 'quarantined'
  else if (unbatchedEventCount > 0 || pendingBatchCount > 0) state = 'ready'
  else if (batchStates.length > 0) state = 'acknowledged'
  else state = 'empty'

  return {
    state,
    workspaceId: workspace.workspace.workspaceId,
    endpointId: workspace.endpoint.endpointId,
    pendingEventCount: scan.pending.length,
    unbatchedEventCount,
    acknowledgedEventCount: scan.acknowledged.length,
    invalidEventCount: scan.invalid.length,
    quarantinedEventCount: scan.quarantined.length,
    pendingBatchCount,
    acknowledgedBatchCount,
    blockers,
  }
}

export async function createNextLocalWorkspaceSignedBatchV1(
  options: CreateNextLocalWorkspaceSignedBatchV1Options,
) {
  const workspace = await loadWorkspace(options)
  if (!workspace) throw new LocalWorkspaceEvidenceBlockedError('a local personal workspace is required')
  const state = await inspectLocalWorkspaceEvidenceV1(options)
  if (state.state === 'blocked' || state.state === 'quarantined') {
    throw new LocalWorkspaceEvidenceBlockedError(
      state.blockers[0] ?? 'workspace evidence is quarantined and requires review',
    )
  }
  return createNextSignedMeasurementBatchV1({
    dataDir: options.dataDir,
    identity: options.identity,
    workspaceId: workspace.workspace.workspaceId,
    metroraVersion: options.metroraVersion,
    adapterSetSha256: options.adapterSetSha256,
    openTelemetryGenAiVersion: options.openTelemetryGenAiVersion,
    ...(options.maxEvents !== undefined ? { maxEvents: options.maxEvents } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
}

function parseExportInput(input: unknown): LocalWorkspaceEvidenceExportV1 {
  if (typeof input === 'string') return LocalWorkspaceEvidenceExportV1Schema.parse(JSON.parse(input))
  if (input instanceof Uint8Array) {
    return LocalWorkspaceEvidenceExportV1Schema.parse(JSON.parse(Buffer.from(input).toString('utf-8')))
  }
  return LocalWorkspaceEvidenceExportV1Schema.parse(input)
}

function verifyExportSignature(value: LocalWorkspaceEvidenceExportV1, payload: string): void {
  const publicKeyBytes = Buffer.from(value.signature.publicKeySpkiBase64, 'base64')
  if (sha256(publicKeyBytes) !== value.signature.publicKeyFingerprintSha256) {
    throw new Error('workspace export signer fingerprint is invalid')
  }
  try {
    const publicKey = createPublicKey({ key: publicKeyBytes, type: 'spki', format: 'der' })
    if (!verify(
      null,
      Buffer.from(payload, 'utf-8'),
      publicKey,
      Buffer.from(value.signature.signatureBase64, 'base64'),
    )) throw new Error('workspace export signature is invalid')
  } catch (error) {
    if (error instanceof Error && error.message === 'workspace export signature is invalid') throw error
    throw new Error('workspace export signing key is invalid')
  }
}

export function verifyLocalWorkspaceEvidenceExportV1(
  input: unknown,
): VerifiedLocalWorkspaceEvidenceExportV1 {
  const value = parseExportInput(input)
  const payload = canonicalPayload(value.payload)
  if (sha256(payload) !== value.payloadSha256) throw new Error('workspace export payload digest is invalid')
  verifyExportSignature(value, payload)

  if (value.signature.identityGeneration !== value.payload.endpointIdentityGeneration) {
    throw new Error('workspace export signer generation does not match the endpoint snapshot')
  }
  if (value.signature.publicKeyFingerprintSha256 !== value.payload.endpoint.identity.publicKeyFingerprintSha256) {
    throw new Error('workspace export signer does not match the enrolled endpoint')
  }

  const signed = verifyLocalSignedMeasurementBatchChainV1(
    value.payload.batches.map(item => item.signed),
    {
      endpointId: value.payload.endpoint.endpointId,
      workspaceId: value.payload.workspace.workspaceId,
    },
  )

  for (const [index, item] of value.payload.batches.entries()) {
    if (item.state !== 'acknowledged') continue
    const batch = signed[index]!
    if (
      item.acknowledgement.batchId !== batch.batch.batchId
      || item.acknowledgement.batchSha256 !== batch.batchSha256
      || item.acknowledgement.acceptedThroughSequence !== batch.range.lastSequence
    ) throw new Error('workspace export acknowledgement does not match its signed batch')
  }

  const expectedSummary = summaryFor(value.payload.batches)
  if (canonicalizeRfc8785(expectedSummary) !== canonicalizeRfc8785(value.payload.summary)) {
    throw new Error('workspace export summary does not match its signed batches')
  }

  return {
    workspaceId: value.payload.workspace.workspaceId,
    endpointId: value.payload.endpoint.endpointId,
    endpointIdentityGeneration: value.payload.endpointIdentityGeneration,
    exportedAt: value.payload.exportedAt,
    batchCount: value.payload.summary.batchCount,
    eventCount: value.payload.summary.eventCount,
    pendingBatchCount: value.payload.summary.pendingBatchCount,
    acknowledgedBatchCount: value.payload.summary.acknowledgedBatchCount,
    ...(value.payload.summary.latestBatchSha256
      ? { latestBatchSha256: value.payload.summary.latestBatchSha256 }
      : {}),
  }
}

export async function createLocalWorkspaceEvidenceExportV1(
  options: CreateLocalWorkspaceEvidenceExportV1Options,
): Promise<LocalWorkspaceEvidenceExportV1> {
  const workspace = await loadWorkspace(options)
  if (!workspace) throw new LocalWorkspaceEvidenceBlockedError('a local personal workspace is required')
  const state = await inspectLocalWorkspaceEvidenceV1(options)
  if (state.state === 'blocked' || state.state === 'quarantined') {
    throw new LocalWorkspaceEvidenceBlockedError(
      state.blockers[0] ?? 'workspace evidence is quarantined and requires review',
    )
  }
  if (state.unbatchedEventCount > 0) {
    throw new LocalWorkspaceEvidenceBlockedError('workspace has unbatched reviewed events')
  }

  const storedBatchStates = await listSignedMeasurementBatchStatesV1({
    dataDir: options.dataDir,
    endpointId: workspace.endpoint.endpointId,
    workspaceId: workspace.workspace.workspaceId,
  })
  const batches = exportBatchStates(storedBatchStates)
  const payload = LocalWorkspaceEvidencePayloadV1Schema.parse({
    kind: LOCAL_WORKSPACE_EVIDENCE_PAYLOAD_KIND,
    version: 1,
    exportedAt: (options.now ?? (() => new Date()))().toISOString(),
    workspace: workspace.workspace,
    ownerMembership: workspace.ownerMembership,
    endpoint: workspace.endpoint,
    endpointIdentityGeneration: workspace.endpointIdentityGeneration,
    summary: summaryFor(batches),
    batches,
  })
  const canonical = canonicalPayload(payload)
  const signature = signWithLocalEndpointIdentityV1(options.identity, Buffer.from(canonical, 'utf-8'))
  const result = LocalWorkspaceEvidenceExportV1Schema.parse({
    kind: LOCAL_WORKSPACE_EVIDENCE_EXPORT_KIND,
    version: 1,
    canonicalization: 'RFC8785',
    payloadSha256: sha256(canonical),
    payload,
    signature: {
      algorithm: 'ed25519',
      identityGeneration: options.identity.metadata.generation,
      publicKeySpkiBase64: options.identity.metadata.publicKeySpkiBase64,
      publicKeyFingerprintSha256: options.identity.metadata.publicKeyFingerprintSha256,
      signatureBase64: Buffer.from(signature).toString('base64'),
    },
  })
  verifyLocalWorkspaceEvidenceExportV1(result)
  if (options.outputPath !== undefined) {
    if (!options.outputPath.trim()) throw new Error('workspace evidence export path must not be empty')
    await atomicWritePrivateFile(options.outputPath, JSON.stringify(result))
  }
  return result
}