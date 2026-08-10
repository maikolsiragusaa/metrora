import { join } from 'node:path'
import * as z from 'zod/v4'

import { atomicWritePrivateFile, readOptionalPrivateFile } from './atomic-file.js'
import {
  defaultMetroraDataDir,
  LocalEndpointIdentityMetadataV1Schema,
  type LocalEndpointIdentityMetadataV1,
} from './endpoint-identity.js'
import {
  loadLocalPersonalWorkspaceV1,
  LocalPersonalWorkspaceStateV1Schema,
  LocalWorkspaceRecoveryRequiredError,
  type LocalPersonalWorkspaceStateV1,
} from './local-workspace.js'
import { withLocalStateLease } from './local-state-lease.js'

const SoftwareVersionSchema = z.string().trim().min(1).max(64)
const WORKSPACE_STATE_FILE = 'local-personal-workspace.v1.json'

export type ReconcileLocalWorkspaceSoftwareV1Options = {
  endpointIdentity: LocalEndpointIdentityMetadataV1
  metroraVersion: string
  collectorVersion: string
  dataDir?: string
  now?: () => Date
}

export type ReconcileLocalWorkspaceSoftwareV1Result = {
  outcome: 'missing' | 'unchanged' | 'updated'
  state?: LocalPersonalWorkspaceStateV1
}

/**
 * Persist the software versions currently running on an already-enrolled local
 * endpoint without minting a new Workspace, endpoint identity, membership or
 * evidence chain. The frozen `metroraVersion` field name remains a v1 wire
 * compatibility detail; its value is always the current Metrora version.
 */
export async function reconcileLocalWorkspaceSoftwareV1(
  input: ReconcileLocalWorkspaceSoftwareV1Options,
): Promise<ReconcileLocalWorkspaceSoftwareV1Result> {
  const endpointIdentity = LocalEndpointIdentityMetadataV1Schema.parse(input.endpointIdentity)
  const metroraVersion = SoftwareVersionSchema.parse(input.metroraVersion)
  const collectorVersion = SoftwareVersionSchema.parse(input.collectorVersion)
  const dataDir = input.dataDir ?? defaultMetroraDataDir()
  const now = input.now ?? (() => new Date())

  // Reuse the existing loader as the identity-generation authority first. It
  // performs any required identity reconciliation under the same Workspace lock.
  const authoritative = await loadLocalPersonalWorkspaceV1({
    dataDir,
    endpointIdentity,
    now,
  })
  if (!authoritative) return { outcome: 'missing' }

  const workspaceDirectory = join(dataDir, 'workspace')
  const statePath = join(workspaceDirectory, WORKSPACE_STATE_FILE)

  return withLocalStateLease(workspaceDirectory, async () => {
    const bytes = await readOptionalPrivateFile(statePath)
    if (!bytes) return { outcome: 'missing' }

    let stored: LocalPersonalWorkspaceStateV1
    try {
      stored = LocalPersonalWorkspaceStateV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
    } catch (error) {
      throw new LocalWorkspaceRecoveryRequiredError(
        `local workspace state is invalid during software reconciliation: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (
      stored.endpoint.endpointId !== endpointIdentity.endpointId ||
      stored.endpointIdentityGeneration !== endpointIdentity.generation ||
      stored.endpoint.identity.publicKeyFingerprintSha256 !== endpointIdentity.publicKeyFingerprintSha256
    ) {
      throw new LocalWorkspaceRecoveryRequiredError(
        'local workspace endpoint identity changed during software reconciliation',
      )
    }

    if (
      stored.endpoint.software.metroraVersion === metroraVersion &&
      stored.endpoint.software.collectorVersion === collectorVersion
    ) {
      return { outcome: 'unchanged', state: stored }
    }

    const updatedAt = now().toISOString()
    const reconciled = LocalPersonalWorkspaceStateV1Schema.parse({
      ...stored,
      endpoint: {
        ...stored.endpoint,
        software: {
          metroraVersion: metroraVersion,
          collectorVersion,
        },
        updatedAt,
        lastSeenAt: updatedAt,
      },
      updatedAt,
    })

    await atomicWritePrivateFile(statePath, JSON.stringify(reconciled))
    return { outcome: 'updated', state: reconciled }
  })
}
