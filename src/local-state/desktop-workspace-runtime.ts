import { createHash } from 'node:crypto'
import * as z from 'zod/v4'

import { SlugSchema, TimestampSchema } from '../contracts/v1/common.js'
import {
  CollectorProvenanceProfilesV1,
} from '../contracts/v1/collector-provenance.js'
import {
  EndpointArchitectureSchema,
  EndpointCapabilitySchema,
  EndpointOsSchema,
  type EndpointCapabilityV1,
} from '../contracts/v1/endpoint.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import type { LoadedLocalEndpointIdentityV1 } from './endpoint-identity.js'
import {
  createLocalPersonalWorkspaceV1,
  loadLocalPersonalWorkspaceV1,
} from './local-workspace.js'
import {
  inspectLocalWorkspaceProductionLifecycleV1,
  LocalWorkspaceProductionModeV1Schema,
  setLocalWorkspaceProductionModeV1,
  type LocalWorkspaceProductionModeV1,
} from './workspace-production-lifecycle.js'
import {
  createLocalWorkspaceEvidenceExportV1,
  createNextLocalWorkspaceSignedBatchV1,
  inspectLocalWorkspaceEvidenceV1,
  verifyLocalWorkspaceEvidenceExportV1,
  type LocalWorkspaceEvidenceStateKindV1,
} from './workspace-evidence.js'

const DisplayNameSchema = z.string().trim().min(1).max(120)
const SoftwareVersionSchema = z.string().trim().min(1).max(64)
const OutputPathSchema = z.string().trim().min(1).max(32_768)

const DesktopWorkspaceEvidenceSummaryV1Schema = z.strictObject({
  state: z.enum([
    'workspace-required',
    'empty',
    'ready',
    'acknowledged',
    'quarantined',
    'blocked',
  ]),
  pendingEventCount: z.number().int().nonnegative(),
  unbatchedEventCount: z.number().int().nonnegative(),
  acknowledgedEventCount: z.number().int().nonnegative(),
  invalidEventCount: z.number().int().nonnegative(),
  quarantinedEventCount: z.number().int().nonnegative(),
  pendingBatchCount: z.number().int().nonnegative(),
  acknowledgedBatchCount: z.number().int().nonnegative(),
  blockers: z.array(z.string().trim().min(1).max(500)).max(32),
})

const DesktopWorkspaceProductionLifecycleV1Schema = z.strictObject({
  mode: LocalWorkspaceProductionModeV1Schema,
  revision: z.number().int().nonnegative(),
  persisted: z.boolean(),
  updatedAt: TimestampSchema.nullable(),
})

const DesktopWorkspaceRecordV1Schema = z.strictObject({
  workspaceId: z.string().min(3).max(128),
  displayName: DisplayNameSchema,
  slug: SlugSchema,
  ownership: z.literal('personal'),
  status: z.literal('active'),
  ownerRole: z.literal('owner'),
  endpoint: z.strictObject({
    endpointId: z.string().min(3).max(128),
    displayName: DisplayNameSchema,
    os: EndpointOsSchema,
    architecture: EndpointArchitectureSchema,
    identityGeneration: z.number().int().positive(),
    publicKeyFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
    metroraVersion: SoftwareVersionSchema,
    collectorVersion: SoftwareVersionSchema,
    capabilities: z.array(EndpointCapabilitySchema).min(1).max(8),
    enrollmentState: z.literal('active'),
  }),
})

export const DesktopWorkspaceSnapshotV1Schema = z.strictObject({
  kind: z.literal('metrora.desktop-workspace-snapshot'),
  version: z.literal(1),
  localOnly: z.literal(true),
  identity: z.strictObject({
    endpointId: z.string().min(3).max(128),
    generation: z.number().int().positive(),
    publicKeyFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  workspace: DesktopWorkspaceRecordV1Schema.nullable(),
  productionLifecycle: DesktopWorkspaceProductionLifecycleV1Schema.nullable().optional(),
  evidence: DesktopWorkspaceEvidenceSummaryV1Schema,
  privacy: z.strictObject({
    networkRequired: z.literal(false),
    promptsIncluded: z.literal(false),
    responsesIncluded: z.literal(false),
    sourceCodeIncluded: z.literal(false),
    secretsIncluded: z.literal(false),
    unrestrictedLocalPathsIncluded: z.literal(false),
  }),
})

export const CreateDesktopWorkspaceInputV1Schema = z.strictObject({
  displayName: DisplayNameSchema,
  slug: SlugSchema.optional(),
  endpointDisplayName: DisplayNameSchema,
})

export type DesktopWorkspaceSnapshotV1 = z.infer<typeof DesktopWorkspaceSnapshotV1Schema>
export type CreateDesktopWorkspaceInputV1 = z.infer<typeof CreateDesktopWorkspaceInputV1Schema>

export type DesktopWorkspaceRuntimeV1Options = {
  dataDir: string
  identity: LoadedLocalEndpointIdentityV1
  platform: {
    os: z.infer<typeof EndpointOsSchema>
    architecture: z.infer<typeof EndpointArchitectureSchema>
  }
  metroraVersion: string
  collectorVersion: string
  capabilities?: EndpointCapabilityV1[]
  openTelemetryGenAiVersion?: string
  now?: () => Date
}

export type DesktopWorkspaceBatchResultV1 = {
  outcome: 'created' | 'empty'
  batch?: {
    batchId: string
    batchSha256: string
    firstSequence: number
    lastSequence: number
    eventCount: number
    identityGeneration: number
  }
  snapshot: DesktopWorkspaceSnapshotV1
}

export type DesktopWorkspaceExportResultV1 = {
  outputPath: string
  verification: {
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
  snapshot: DesktopWorkspaceSnapshotV1
}

export type DesktopWorkspaceProductionLifecycleResultV1 = {
  outcome: 'changed' | 'unchanged'
  snapshot: DesktopWorkspaceSnapshotV1
}

export interface DesktopWorkspaceRuntimeV1 {
  getSnapshot(): Promise<DesktopWorkspaceSnapshotV1>
  createWorkspace(input: CreateDesktopWorkspaceInputV1): Promise<{
    outcome: 'created' | 'existing'
    snapshot: DesktopWorkspaceSnapshotV1
  }>
  setProductionMode(mode: LocalWorkspaceProductionModeV1): Promise<DesktopWorkspaceProductionLifecycleResultV1>
  createNextBatch(): Promise<DesktopWorkspaceBatchResultV1>
  exportEvidence(outputPath: string): Promise<DesktopWorkspaceExportResultV1>
  dispose(): void
}

function reviewedAdapterSetSha256(): string {
  return createHash('sha256')
    .update(canonicalizeRfc8785(CollectorProvenanceProfilesV1))
    .digest('hex')
}

function slugifyWorkspaceName(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  const candidate = normalized.length >= 2 ? normalized : 'my-workspace'
  return SlugSchema.parse(candidate)
}

function emptyEvidence(state: LocalWorkspaceEvidenceStateKindV1 = 'workspace-required') {
  return DesktopWorkspaceEvidenceSummaryV1Schema.parse({
    state,
    pendingEventCount: 0,
    unbatchedEventCount: 0,
    acknowledgedEventCount: 0,
    invalidEventCount: 0,
    quarantinedEventCount: 0,
    pendingBatchCount: 0,
    acknowledgedBatchCount: 0,
    blockers: state === 'workspace-required' ? ['Local personal workspace is not configured.'] : [],
  })
}

function disposeIdentity(identity: LoadedLocalEndpointIdentityV1): void {
  identity.privateKeyPkcs8.fill(0)
  identity.eventIdentityKey.fill(0)
}

export function createDesktopWorkspaceRuntimeV1(
  input: DesktopWorkspaceRuntimeV1Options,
): DesktopWorkspaceRuntimeV1 {
  const options = {
    dataDir: z.string().trim().min(1).parse(input.dataDir),
    identity: input.identity,
    platform: z.strictObject({
      os: EndpointOsSchema,
      architecture: EndpointArchitectureSchema,
    }).parse(input.platform),
    metroraVersion: SoftwareVersionSchema.parse(input.metroraVersion),
    collectorVersion: SoftwareVersionSchema.parse(input.collectorVersion),
    capabilities: z.array(EndpointCapabilitySchema).min(1).max(8).parse(
      input.capabilities ?? ['collect', 'normalize', 'aggregate', 'serve-local-api'],
    ),
    openTelemetryGenAiVersion: SoftwareVersionSchema.parse(input.openTelemetryGenAiVersion ?? '1.37.0'),
    now: input.now ?? (() => new Date()),
  }
  const adapterSetSha256 = reviewedAdapterSetSha256()
  let disposed = false

  const requireActive = () => {
    if (disposed) throw new Error('desktop Workspace runtime has been disposed')
  }

  const getSnapshot = async (): Promise<DesktopWorkspaceSnapshotV1> => {
    requireActive()
    const workspace = await loadLocalPersonalWorkspaceV1({
      dataDir: options.dataDir,
      endpointIdentity: options.identity.metadata,
      now: options.now,
    })
    if (!workspace) {
      return DesktopWorkspaceSnapshotV1Schema.parse({
        kind: 'metrora.desktop-workspace-snapshot',
        version: 1,
        localOnly: true,
        identity: {
          endpointId: options.identity.metadata.endpointId,
          generation: options.identity.metadata.generation,
          publicKeyFingerprintSha256: options.identity.metadata.publicKeyFingerprintSha256,
        },
        workspace: null,
        productionLifecycle: null,
        evidence: emptyEvidence(),
        privacy: {
          networkRequired: false,
          promptsIncluded: false,
          responsesIncluded: false,
          sourceCodeIncluded: false,
          secretsIncluded: false,
          unrestrictedLocalPathsIncluded: false,
        },
      })
    }

    const [productionLifecycle, evidence] = await Promise.all([
      inspectLocalWorkspaceProductionLifecycleV1({
        dataDir: options.dataDir,
        endpointIdentity: options.identity.metadata,
        now: options.now,
      }),
      inspectLocalWorkspaceEvidenceV1({
        dataDir: options.dataDir,
        identity: options.identity,
        now: options.now,
      }),
    ])
    return DesktopWorkspaceSnapshotV1Schema.parse({
      kind: 'metrora.desktop-workspace-snapshot',
      version: 1,
      localOnly: true,
      identity: {
        endpointId: options.identity.metadata.endpointId,
        generation: options.identity.metadata.generation,
        publicKeyFingerprintSha256: options.identity.metadata.publicKeyFingerprintSha256,
      },
      workspace: {
        workspaceId: workspace.workspace.workspaceId,
        displayName: workspace.workspace.displayName,
        slug: workspace.workspace.slug,
        ownership: workspace.workspace.ownership,
        status: workspace.workspace.status,
        ownerRole: workspace.ownerMembership.role,
        endpoint: {
          endpointId: workspace.endpoint.endpointId,
          displayName: workspace.endpoint.displayName,
          os: workspace.endpoint.platform.os,
          architecture: workspace.endpoint.platform.architecture,
          identityGeneration: workspace.endpointIdentityGeneration,
          publicKeyFingerprintSha256: workspace.endpoint.identity.publicKeyFingerprintSha256,
          metroraVersion: workspace.endpoint.software.metroraVersion,
          collectorVersion: workspace.endpoint.software.collectorVersion,
          capabilities: workspace.endpoint.capabilities,
          enrollmentState: workspace.endpoint.enrollment.state,
        },
      },
      productionLifecycle,
      evidence: {
        state: evidence.state,
        pendingEventCount: evidence.pendingEventCount,
        unbatchedEventCount: evidence.unbatchedEventCount,
        acknowledgedEventCount: evidence.acknowledgedEventCount,
        invalidEventCount: evidence.invalidEventCount,
        quarantinedEventCount: evidence.quarantinedEventCount,
        pendingBatchCount: evidence.pendingBatchCount,
        acknowledgedBatchCount: evidence.acknowledgedBatchCount,
        blockers: evidence.blockers,
      },
      privacy: {
        networkRequired: false,
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        secretsIncluded: false,
        unrestrictedLocalPathsIncluded: false,
      },
    })
  }

  return {
    getSnapshot,

    async createWorkspace(rawInput) {
      requireActive()
      const parsed = CreateDesktopWorkspaceInputV1Schema.parse(rawInput)
      const created = await createLocalPersonalWorkspaceV1({
        dataDir: options.dataDir,
        endpointIdentity: options.identity.metadata,
        now: options.now,
        intent: {
          workspace: {
            displayName: parsed.displayName,
            slug: parsed.slug ?? slugifyWorkspaceName(parsed.displayName),
          },
          endpoint: {
            displayName: parsed.endpointDisplayName,
            platform: options.platform,
            metroraVersion: options.metroraVersion,
            collectorVersion: options.collectorVersion,
            capabilities: options.capabilities,
          },
        },
      })
      return { outcome: created.outcome, snapshot: await getSnapshot() }
    },

    async setProductionMode(rawMode) {
      requireActive()
      const mode = LocalWorkspaceProductionModeV1Schema.parse(rawMode)
      const result = await setLocalWorkspaceProductionModeV1({
        dataDir: options.dataDir,
        endpointIdentity: options.identity.metadata,
        mode,
        now: options.now,
      })
      return { outcome: result.outcome, snapshot: await getSnapshot() }
    },

    async createNextBatch() {
      requireActive()
      const signed = await createNextLocalWorkspaceSignedBatchV1({
        dataDir: options.dataDir,
        identity: options.identity,
        metroraVersion: options.metroraVersion,
        adapterSetSha256,
        openTelemetryGenAiVersion: options.openTelemetryGenAiVersion,
        now: options.now,
      })
      return {
        outcome: signed ? 'created' : 'empty',
        ...(signed ? {
          batch: {
            batchId: signed.batch.batchId,
            batchSha256: signed.batchSha256,
            firstSequence: signed.range.firstSequence,
            lastSequence: signed.range.lastSequence,
            eventCount: signed.range.eventCount,
            identityGeneration: signed.signature.identityGeneration,
          },
        } : {}),
        snapshot: await getSnapshot(),
      }
    },

    async exportEvidence(rawOutputPath) {
      requireActive()
      const outputPath = OutputPathSchema.parse(rawOutputPath)
      const exported = await createLocalWorkspaceEvidenceExportV1({
        dataDir: options.dataDir,
        identity: options.identity,
        outputPath,
        now: options.now,
      })
      const verification = verifyLocalWorkspaceEvidenceExportV1(exported)
      return {
        outputPath,
        verification,
        snapshot: await getSnapshot(),
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      disposeIdentity(options.identity)
    },
  }
}
