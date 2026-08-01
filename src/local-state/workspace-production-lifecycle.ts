import { join } from 'node:path'
import * as z from 'zod/v4'

import {
  OpaqueIdSchema,
  PositiveIntegerSchema,
  TimestampSchema,
} from '../contracts/v1/common.js'
import {
  defaultMetroraDataDir,
  LocalEndpointIdentityMetadataV1Schema,
  type LocalEndpointIdentityMetadataV1,
} from './endpoint-identity.js'
import {
  loadLocalPersonalWorkspaceV1,
  type LocalPersonalWorkspaceStateV1,
} from './local-workspace.js'
import { atomicWritePrivateFile, readOptionalPrivateFile } from './atomic-file.js'
import { withLocalStateLease } from './local-state-lease.js'

export const LOCAL_WORKSPACE_PRODUCTION_LIFECYCLE_KIND = 'metrora.local-workspace-production-lifecycle' as const
const LOCAL_WORKSPACE_PRODUCTION_LIFECYCLE_FILE = 'workspace-production-lifecycle.v1.json'

export const LocalWorkspaceProductionModeV1Schema = z.enum(['active', 'paused'])

export const LocalWorkspaceProductionLifecycleStateV1Schema = z.strictObject({
  kind: z.literal(LOCAL_WORKSPACE_PRODUCTION_LIFECYCLE_KIND),
  version: z.literal(1),
  workspaceId: OpaqueIdSchema,
  endpointId: OpaqueIdSchema,
  mode: LocalWorkspaceProductionModeV1Schema,
  revision: PositiveIntegerSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).superRefine((state, ctx) => {
  if (Date.parse(state.createdAt) > Date.parse(state.updatedAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'production lifecycle cannot be updated before it was created',
    })
  }
})

export const LocalWorkspaceProductionLifecycleSummaryV1Schema = z.strictObject({
  mode: LocalWorkspaceProductionModeV1Schema,
  revision: z.number().int().nonnegative(),
  persisted: z.boolean(),
  updatedAt: TimestampSchema.nullable(),
})

export type LocalWorkspaceProductionModeV1 = z.infer<typeof LocalWorkspaceProductionModeV1Schema>
export type LocalWorkspaceProductionLifecycleStateV1 = z.infer<typeof LocalWorkspaceProductionLifecycleStateV1Schema>
export type LocalWorkspaceProductionLifecycleSummaryV1 = z.infer<typeof LocalWorkspaceProductionLifecycleSummaryV1Schema>

export type LocalWorkspaceProductionLifecycleOptions = {
  endpointIdentity: LocalEndpointIdentityMetadataV1
  dataDir?: string
  now?: () => Date
}

export type SetLocalWorkspaceProductionModeV1Options = LocalWorkspaceProductionLifecycleOptions & {
  mode: LocalWorkspaceProductionModeV1
}

export type SetLocalWorkspaceProductionModeV1Result = {
  outcome: 'changed' | 'unchanged'
  lifecycle: LocalWorkspaceProductionLifecycleSummaryV1
}

export class LocalWorkspaceProductionLifecycleRecoveryRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalWorkspaceProductionLifecycleRecoveryRequiredError'
  }
}

export class LocalWorkspaceProductionLifecycleWorkspaceRequiredError extends Error {
  constructor() {
    super('local personal workspace is required before changing production lifecycle')
    this.name = 'LocalWorkspaceProductionLifecycleWorkspaceRequiredError'
  }
}

function lifecyclePaths(dataDir: string): { directory: string; state: string } {
  const directory = join(dataDir, 'workspace')
  return {
    directory,
    state: join(directory, LOCAL_WORKSPACE_PRODUCTION_LIFECYCLE_FILE),
  }
}

function timestamp(now: () => Date): string {
  return TimestampSchema.parse(now().toISOString())
}

function parseState(bytes: Uint8Array): LocalWorkspaceProductionLifecycleStateV1 {
  try {
    return LocalWorkspaceProductionLifecycleStateV1Schema.parse(
      JSON.parse(Buffer.from(bytes).toString('utf-8')),
    )
  } catch (error) {
    throw new LocalWorkspaceProductionLifecycleRecoveryRequiredError(
      `local Workspace production lifecycle is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validateIdentity(metadata: LocalEndpointIdentityMetadataV1): LocalEndpointIdentityMetadataV1 {
  return LocalEndpointIdentityMetadataV1Schema.parse(metadata)
}

async function requireWorkspace(input: {
  endpointIdentity: LocalEndpointIdentityMetadataV1
  dataDir: string
  now: () => Date
}): Promise<LocalPersonalWorkspaceStateV1> {
  const workspace = await loadLocalPersonalWorkspaceV1({
    endpointIdentity: input.endpointIdentity,
    dataDir: input.dataDir,
    now: input.now,
  })
  if (!workspace) throw new LocalWorkspaceProductionLifecycleWorkspaceRequiredError()
  return workspace
}

async function readState(path: string): Promise<LocalWorkspaceProductionLifecycleStateV1 | undefined> {
  let bytes: Buffer | undefined
  try {
    bytes = await readOptionalPrivateFile(path)
  } catch (error) {
    throw new LocalWorkspaceProductionLifecycleRecoveryRequiredError(
      `local Workspace production lifecycle could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return bytes ? parseState(bytes) : undefined
}

function validateBinding(
  stored: LocalWorkspaceProductionLifecycleStateV1,
  workspace: LocalPersonalWorkspaceStateV1,
): LocalWorkspaceProductionLifecycleStateV1 {
  if (stored.workspaceId !== workspace.workspace.workspaceId) {
    throw new LocalWorkspaceProductionLifecycleRecoveryRequiredError(
      'local Workspace production lifecycle is bound to a different workspace',
    )
  }
  if (stored.endpointId !== workspace.endpoint.endpointId) {
    throw new LocalWorkspaceProductionLifecycleRecoveryRequiredError(
      'local Workspace production lifecycle is bound to a different endpoint',
    )
  }
  return stored
}

function summary(
  state: LocalWorkspaceProductionLifecycleStateV1 | undefined,
): LocalWorkspaceProductionLifecycleSummaryV1 {
  return LocalWorkspaceProductionLifecycleSummaryV1Schema.parse(state ? {
    mode: state.mode,
    revision: state.revision,
    persisted: true,
    updatedAt: state.updatedAt,
  } : {
    mode: 'active',
    revision: 0,
    persisted: false,
    updatedAt: null,
  })
}

export async function inspectLocalWorkspaceProductionLifecycleV1(
  input: LocalWorkspaceProductionLifecycleOptions,
): Promise<LocalWorkspaceProductionLifecycleSummaryV1> {
  const endpointIdentity = validateIdentity(input.endpointIdentity)
  const dataDir = input.dataDir ?? defaultMetroraDataDir()
  const now = input.now ?? (() => new Date())
  const workspace = await requireWorkspace({ endpointIdentity, dataDir, now })
  const paths = lifecyclePaths(dataDir)

  return withLocalStateLease(paths.directory, async () => {
    const stored = await readState(paths.state)
    return summary(stored ? validateBinding(stored, workspace) : undefined)
  })
}

export async function setLocalWorkspaceProductionModeV1(
  input: SetLocalWorkspaceProductionModeV1Options,
): Promise<SetLocalWorkspaceProductionModeV1Result> {
  const endpointIdentity = validateIdentity(input.endpointIdentity)
  const mode = LocalWorkspaceProductionModeV1Schema.parse(input.mode)
  const dataDir = input.dataDir ?? defaultMetroraDataDir()
  const now = input.now ?? (() => new Date())
  const workspace = await requireWorkspace({ endpointIdentity, dataDir, now })
  const paths = lifecyclePaths(dataDir)

  return withLocalStateLease(paths.directory, async () => {
    const existingRaw = await readState(paths.state)
    const existing = existingRaw ? validateBinding(existingRaw, workspace) : undefined

    if ((!existing && mode === 'active') || existing?.mode === mode) {
      return { outcome: 'unchanged', lifecycle: summary(existing) }
    }

    const updatedAt = timestamp(now)
    if (existing && Date.parse(updatedAt) < Date.parse(existing.updatedAt)) {
      throw new LocalWorkspaceProductionLifecycleRecoveryRequiredError(
        'local Workspace production lifecycle clock moved backwards',
      )
    }
    const next = LocalWorkspaceProductionLifecycleStateV1Schema.parse({
      kind: LOCAL_WORKSPACE_PRODUCTION_LIFECYCLE_KIND,
      version: 1,
      workspaceId: workspace.workspace.workspaceId,
      endpointId: workspace.endpoint.endpointId,
      mode,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
    })
    await atomicWritePrivateFile(paths.state, JSON.stringify(next))
    return { outcome: 'changed', lifecycle: summary(next) }
  })
}
