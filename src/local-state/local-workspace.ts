import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import * as z from 'zod/v4'

import {
  EndpointArchitectureSchema,
  EndpointCapabilitySchema,
  EndpointOsSchema,
  EndpointV1Schema,
  type EndpointCapabilityV1,
  type EndpointV1,
} from '../contracts/v1/endpoint.js'
import {
  OpaqueIdSchema,
  PositiveIntegerSchema,
  SlugSchema,
  TimestampSchema,
} from '../contracts/v1/common.js'
import {
  WorkspaceMembershipV1Schema,
  WorkspaceV1Schema,
  type WorkspaceMembershipV1,
  type WorkspaceV1,
} from '../contracts/v1/workspace.js'
import {
  defaultMetroraDataDir,
  LocalEndpointIdentityMetadataV1Schema,
  type LocalEndpointIdentityMetadataV1,
} from './endpoint-identity.js'
import { atomicWritePrivateFile, readOptionalPrivateFile } from './atomic-file.js'
import { withLocalStateLease } from './local-state-lease.js'

export const LOCAL_PERSONAL_WORKSPACE_STATE_KIND = 'metrora.local-personal-workspace-state' as const
const LOCAL_PERSONAL_WORKSPACE_STATE_FILE = 'local-personal-workspace.v1.json'

const DisplayNameSchema = z.string().trim().min(1).max(120)
const SoftwareVersionSchema = z.string().trim().min(1).max(64)
const EndpointCapabilitiesSchema = z
  .array(EndpointCapabilitySchema)
  .min(1)
  .max(8)
  .refine(values => new Set(values).size === values.length, 'endpoint capabilities must be unique')

const CreateLocalPersonalWorkspaceIntentV1Schema = z.strictObject({
  workspace: z.strictObject({
    displayName: DisplayNameSchema,
    slug: SlugSchema,
  }),
  endpoint: z.strictObject({
    displayName: DisplayNameSchema,
    platform: z.strictObject({
      os: EndpointOsSchema,
      architecture: EndpointArchitectureSchema,
    }),
    metroraVersion: SoftwareVersionSchema,
    collectorVersion: SoftwareVersionSchema,
    capabilities: EndpointCapabilitiesSchema,
  }),
})

const LocalPersonalWorkspaceStateV1BaseSchema = z.strictObject({
  kind: z.literal(LOCAL_PERSONAL_WORKSPACE_STATE_KIND),
  version: z.literal(1),
  localSubjectId: OpaqueIdSchema,
  endpointIdentityGeneration: PositiveIntegerSchema,
  workspace: WorkspaceV1Schema,
  ownerMembership: WorkspaceMembershipV1Schema,
  endpoint: EndpointV1Schema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const LocalPersonalWorkspaceStateV1Schema = LocalPersonalWorkspaceStateV1BaseSchema.superRefine((state, ctx) => {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message })
  }

  if (state.workspace.ownership !== 'personal') {
    issue(['workspace', 'ownership'], 'local workspace ownership must be personal')
  }
  if (state.workspace.status !== 'active') {
    issue(['workspace', 'status'], 'local workspace must be active')
  }
  if (state.ownerMembership.workspaceId !== state.workspace.workspaceId) {
    issue(['ownerMembership', 'workspaceId'], 'membership must belong to the local workspace')
  }
  if (state.ownerMembership.principal.type !== 'user') {
    issue(['ownerMembership', 'principal', 'type'], 'local owner principal must be a user')
  }
  if (state.ownerMembership.principal.principalId !== state.localSubjectId) {
    issue(['ownerMembership', 'principal', 'principalId'], 'membership must bind the local subject')
  }
  if (state.ownerMembership.role !== 'owner' || state.ownerMembership.status !== 'active') {
    issue(['ownerMembership'], 'local membership must be an active owner')
  }
  if (state.endpoint.workspaceId !== state.workspace.workspaceId) {
    issue(['endpoint', 'workspaceId'], 'endpoint must belong to the local workspace')
  }
  if (state.endpoint.endpointType !== 'desktop') {
    issue(['endpoint', 'endpointType'], 'Workspace v1 enrolls a desktop endpoint')
  }
  if (state.endpoint.identity.keyAlgorithm !== 'ed25519') {
    issue(['endpoint', 'identity', 'keyAlgorithm'], 'endpoint must reuse the local Ed25519 identity')
  }
  if (state.endpoint.enrollment.state !== 'active') {
    issue(['endpoint', 'enrollment'], 'local endpoint enrollment must be active')
  }
  if (state.createdAt > state.updatedAt) {
    issue(['updatedAt'], 'workspace state cannot be updated before it was created')
  }
})

export type LocalPersonalWorkspaceStateV1 = z.infer<typeof LocalPersonalWorkspaceStateV1Schema>

export type CreateLocalPersonalWorkspaceIntentV1 = {
  workspace: {
    displayName: string
    slug: string
  }
  endpoint: {
    displayName: string
    platform: {
      os: z.infer<typeof EndpointOsSchema>
      architecture: z.infer<typeof EndpointArchitectureSchema>
    }
    metroraVersion: string
    collectorVersion: string
    capabilities: EndpointCapabilityV1[]
  }
}

export type LocalPersonalWorkspaceStoreOptions = {
  endpointIdentity: LocalEndpointIdentityMetadataV1
  dataDir?: string
  now?: () => Date
}

export type CreateLocalPersonalWorkspaceV1Options = LocalPersonalWorkspaceStoreOptions & {
  intent: CreateLocalPersonalWorkspaceIntentV1
  randomUUID?: () => string
}

export type CreateLocalPersonalWorkspaceV1Result = {
  outcome: 'created' | 'existing'
  state: LocalPersonalWorkspaceStateV1
}

export class LocalWorkspaceRecoveryRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalWorkspaceRecoveryRequiredError'
  }
}

function workspacePaths(dataDir: string): { directory: string; state: string } {
  const directory = join(dataDir, 'workspace')
  return {
    directory,
    state: join(directory, LOCAL_PERSONAL_WORKSPACE_STATE_FILE),
  }
}

function timestamp(now: () => Date): string {
  return TimestampSchema.parse(now().toISOString())
}

function opaqueId(prefix: 'workspace' | 'membership' | 'subject', uuid: () => string): string {
  return OpaqueIdSchema.parse(`${prefix}_${uuid()}`)
}

function parseState(bytes: Uint8Array): LocalPersonalWorkspaceStateV1 {
  try {
    return LocalPersonalWorkspaceStateV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
  } catch (error) {
    throw new LocalWorkspaceRecoveryRequiredError(
      `local workspace state is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validateIdentity(metadata: LocalEndpointIdentityMetadataV1): LocalEndpointIdentityMetadataV1 {
  return LocalEndpointIdentityMetadataV1Schema.parse(metadata)
}

function buildState(input: {
  identity: LocalEndpointIdentityMetadataV1
  intent: z.infer<typeof CreateLocalPersonalWorkspaceIntentV1Schema>
  now: () => Date
  randomUUID: () => string
}): LocalPersonalWorkspaceStateV1 {
  const createdAt = timestamp(input.now)
  const workspaceId = opaqueId('workspace', input.randomUUID)
  const membershipId = opaqueId('membership', input.randomUUID)
  const localSubjectId = opaqueId('subject', input.randomUUID)

  const workspace: WorkspaceV1 = WorkspaceV1Schema.parse({
    kind: 'metrora.workspace',
    version: 1,
    workspaceId,
    slug: input.intent.workspace.slug,
    displayName: input.intent.workspace.displayName,
    ownership: 'personal',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })

  const ownerMembership: WorkspaceMembershipV1 = WorkspaceMembershipV1Schema.parse({
    kind: 'metrora.workspace-membership',
    version: 1,
    membershipId,
    workspaceId,
    principal: {
      type: 'user',
      principalId: localSubjectId,
    },
    role: 'owner',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })

  const endpoint: EndpointV1 = EndpointV1Schema.parse({
    kind: 'metrora.endpoint',
    version: 1,
    endpointId: input.identity.endpointId,
    workspaceId,
    displayName: input.intent.endpoint.displayName,
    endpointType: 'desktop',
    platform: input.intent.endpoint.platform,
    identity: {
      keyAlgorithm: 'ed25519',
      publicKeyFingerprintSha256: input.identity.publicKeyFingerprintSha256,
    },
    // The metroraVersion field name is frozen in public contract v1. Its value
    // is the current Metrora version and must not be interpreted as old branding.
    software: {
      metroraVersion: input.intent.endpoint.metroraVersion,
      collectorVersion: input.intent.endpoint.collectorVersion,
    },
    capabilities: input.intent.endpoint.capabilities,
    enrollment: {
      state: 'active',
      requestedAt: createdAt,
      enrolledAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
    lastSeenAt: createdAt,
  })

  return LocalPersonalWorkspaceStateV1Schema.parse({
    kind: LOCAL_PERSONAL_WORKSPACE_STATE_KIND,
    version: 1,
    localSubjectId,
    endpointIdentityGeneration: input.identity.generation,
    workspace,
    ownerMembership,
    endpoint,
    createdAt,
    updatedAt: createdAt,
  })
}

async function readState(path: string): Promise<LocalPersonalWorkspaceStateV1 | undefined> {
  let bytes: Buffer | undefined
  try {
    bytes = await readOptionalPrivateFile(path)
  } catch (error) {
    throw new LocalWorkspaceRecoveryRequiredError(
      `local workspace state could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return bytes ? parseState(bytes) : undefined
}

async function loadAndReconcileUnlocked(input: {
  statePath: string
  identity: LocalEndpointIdentityMetadataV1
  now: () => Date
}): Promise<LocalPersonalWorkspaceStateV1 | undefined> {
  const stored = await readState(input.statePath)
  if (!stored) return undefined

  if (stored.endpoint.endpointId !== input.identity.endpointId) {
    throw new LocalWorkspaceRecoveryRequiredError(
      'local workspace is bound to a different endpoint identity',
    )
  }
  if (stored.endpointIdentityGeneration > input.identity.generation) {
    throw new LocalWorkspaceRecoveryRequiredError(
      'local workspace references a newer endpoint identity generation',
    )
  }
  if (stored.endpointIdentityGeneration === input.identity.generation) {
    if (stored.endpoint.identity.publicKeyFingerprintSha256 !== input.identity.publicKeyFingerprintSha256) {
      throw new LocalWorkspaceRecoveryRequiredError(
        'local workspace endpoint fingerprint does not match the current identity generation',
      )
    }
    return stored
  }

  const updatedAt = timestamp(input.now)
  const reconciled = LocalPersonalWorkspaceStateV1Schema.parse({
    ...stored,
    endpointIdentityGeneration: input.identity.generation,
    endpoint: {
      ...stored.endpoint,
      identity: {
        keyAlgorithm: 'ed25519',
        publicKeyFingerprintSha256: input.identity.publicKeyFingerprintSha256,
      },
      updatedAt,
      lastSeenAt: updatedAt,
    },
    updatedAt,
  })
  await atomicWritePrivateFile(input.statePath, JSON.stringify(reconciled))
  return reconciled
}

export async function loadLocalPersonalWorkspaceV1(
  input: LocalPersonalWorkspaceStoreOptions,
): Promise<LocalPersonalWorkspaceStateV1 | undefined> {
  const identity = validateIdentity(input.endpointIdentity)
  const dataDir = input.dataDir ?? defaultMetroraDataDir()
  const paths = workspacePaths(dataDir)
  const now = input.now ?? (() => new Date())
  return withLocalStateLease(paths.directory, () => loadAndReconcileUnlocked({
    statePath: paths.state,
    identity,
    now,
  }))
}

export async function createLocalPersonalWorkspaceV1(
  input: CreateLocalPersonalWorkspaceV1Options,
): Promise<CreateLocalPersonalWorkspaceV1Result> {
  const identity = validateIdentity(input.endpointIdentity)
  const intent = CreateLocalPersonalWorkspaceIntentV1Schema.parse(input.intent)
  const dataDir = input.dataDir ?? defaultMetroraDataDir()
  const paths = workspacePaths(dataDir)
  const now = input.now ?? (() => new Date())
  const uuid = input.randomUUID ?? randomUUID

  return withLocalStateLease(paths.directory, async () => {
    const existing = await loadAndReconcileUnlocked({
      statePath: paths.state,
      identity,
      now,
    })
    if (existing) return { outcome: 'existing', state: existing }

    const state = buildState({ identity, intent, now, randomUUID: uuid })
    await atomicWritePrivateFile(paths.state, JSON.stringify(state))
    return { outcome: 'created', state }
  })
}
