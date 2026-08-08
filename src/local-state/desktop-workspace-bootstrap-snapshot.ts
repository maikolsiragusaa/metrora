import type { LoadedLocalEndpointIdentityV1 } from './endpoint-identity.js'
import { loadLocalPersonalWorkspaceV1 } from './local-workspace.js'
import {
  DesktopWorkspaceSnapshotV1Schema,
  type DesktopWorkspaceSnapshotV1,
} from './desktop-workspace-runtime.js'
import { inspectLocalWorkspaceProductionLifecycleV1 } from './workspace-production-lifecycle.js'

export const DESKTOP_WORKSPACE_EVIDENCE_INSPECTION_PENDING =
  'Full local evidence inspection is pending. Run explicit recovery before producing, signing, or exporting.'

export type DesktopWorkspaceBootstrapSnapshotV1Options = {
  dataDir: string
  identity: LoadedLocalEndpointIdentityV1
  now?: () => Date
}

/**
 * Read only the protected Workspace identity and lifecycle needed to render the
 * desktop screen. This path deliberately does not enumerate or parse outbox,
 * receipt, quarantine, acknowledgement, or signed-batch directories.
 *
 * Existing evidence is therefore reported fail-closed as blocked until the
 * explicit recovery action performs the complete integrity inspection. The
 * renderer receives no paths, receipt identifiers, source records, or keys.
 */
export async function createDesktopWorkspaceBootstrapSnapshotV1(
  input: DesktopWorkspaceBootstrapSnapshotV1Options,
): Promise<DesktopWorkspaceSnapshotV1> {
  const now = input.now ?? (() => new Date())
  const workspace = await loadLocalPersonalWorkspaceV1({
    dataDir: input.dataDir,
    endpointIdentity: input.identity.metadata,
    now,
  })

  const identity = {
    endpointId: input.identity.metadata.endpointId,
    generation: input.identity.metadata.generation,
    publicKeyFingerprintSha256: input.identity.metadata.publicKeyFingerprintSha256,
  }
  const privacy = {
    networkRequired: false as const,
    promptsIncluded: false as const,
    responsesIncluded: false as const,
    sourceCodeIncluded: false as const,
    secretsIncluded: false as const,
    unrestrictedLocalPathsIncluded: false as const,
  }

  if (!workspace) {
    return DesktopWorkspaceSnapshotV1Schema.parse({
      kind: 'metrora.desktop-workspace-snapshot',
      version: 1,
      localOnly: true,
      identity,
      workspace: null,
      productionLifecycle: null,
      evidence: {
        state: 'workspace-required',
        pendingEventCount: 0,
        unbatchedEventCount: 0,
        acknowledgedEventCount: 0,
        invalidEventCount: 0,
        quarantinedEventCount: 0,
        pendingBatchCount: 0,
        acknowledgedBatchCount: 0,
        blockers: ['Local personal workspace is not configured.'],
      },
      privacy,
    })
  }

  const productionLifecycle = await inspectLocalWorkspaceProductionLifecycleV1({
    dataDir: input.dataDir,
    endpointIdentity: input.identity.metadata,
    now,
  })

  return DesktopWorkspaceSnapshotV1Schema.parse({
    kind: 'metrora.desktop-workspace-snapshot',
    version: 1,
    localOnly: true,
    identity,
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
      state: 'blocked',
      pendingEventCount: 0,
      unbatchedEventCount: 0,
      acknowledgedEventCount: 0,
      invalidEventCount: 0,
      quarantinedEventCount: 0,
      pendingBatchCount: 0,
      acknowledgedBatchCount: 0,
      blockers: [DESKTOP_WORKSPACE_EVIDENCE_INSPECTION_PENDING],
    },
    privacy,
  })
}
