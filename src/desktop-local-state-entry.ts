// Narrow runtime entry loaded by Electron's main process. It deliberately
// exposes desktop-host initialization and public Workspace DTOs/actions;
// raw private identity material never crosses into the renderer or an IPC response.
import {
  initializeDesktopWorkspaceRuntimeV1 as initializeDesktopWorkspaceRuntimeV1Base,
} from './local-state/desktop-host.js'
import type {
  InitializedDesktopWorkspaceRuntimeV1,
  InitializeDesktopWorkspaceRuntimeV1Options,
} from './local-state/desktop-host.js'
import { reconcileLocalWorkspaceSoftwareV1 } from './local-state/workspace-software-reconciliation.js'

export {
  DesktopEncryptedStateUnreadableError,
  DesktopLocalStateCorruptError,
  DesktopVaultUnavailableError,
  initializeDesktopLocalStateV1,
} from './local-state/desktop-host.js'
export type {
  DesktopSafeStorageProvider,
  DesktopVaultBackendV1,
  InitializedDesktopLocalStateV1,
  InitializedDesktopWorkspaceRuntimeV1,
  InitializeDesktopLocalStateV1Options,
  InitializeDesktopWorkspaceRuntimeV1Options,
} from './local-state/desktop-host.js'

export async function initializeDesktopWorkspaceRuntimeV1(
  input: InitializeDesktopWorkspaceRuntimeV1Options,
): Promise<InitializedDesktopWorkspaceRuntimeV1> {
  const initialized = await initializeDesktopWorkspaceRuntimeV1Base(input)
  try {
    await reconcileLocalWorkspaceSoftwareV1({
      endpointIdentity: initialized.endpoint,
      metroraVersion: input.metroraVersion,
      collectorVersion: input.collectorVersion,
      ...(input.dataDir !== undefined ? { dataDir: input.dataDir } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
    })
    return initialized
  } catch (error) {
    initialized.runtime.dispose()
    throw error
  }
}

export {
  DesktopReviewedProductionUnavailableError,
  DesktopWorkspaceRecoverySummaryV1Schema,
} from './local-state/desktop-reviewed-production-runtime.js'
export type {
  DesktopCanonicalReviewedScannerInputV1,
  DesktopCanonicalReviewedScannerV1,
  DesktopReviewedProductionResultV1,
  DesktopReviewedProductionRuntimeV1,
  DesktopWorkspaceRecoveryResultV1,
  DesktopWorkspaceRecoverySummaryV1,
} from './local-state/desktop-reviewed-production-runtime.js'

export {
  CreateDesktopWorkspaceInputV1Schema,
  DesktopWorkspaceSnapshotV1Schema,
} from './local-state/desktop-workspace-runtime.js'
export type {
  CreateDesktopWorkspaceInputV1,
  DesktopWorkspaceBatchResultV1,
  DesktopWorkspaceExportResultV1,
  DesktopWorkspaceProductionLifecycleResultV1,
  DesktopWorkspaceRuntimeV1,
  DesktopWorkspaceSnapshotV1,
} from './local-state/desktop-workspace-runtime.js'

export {
  createLocalPersonalWorkspaceV1,
  loadLocalPersonalWorkspaceV1,
  LocalPersonalWorkspaceStateV1Schema,
  LocalWorkspaceRecoveryRequiredError,
} from './local-state/local-workspace.js'
export type {
  CreateLocalPersonalWorkspaceIntentV1,
  CreateLocalPersonalWorkspaceV1Options,
  CreateLocalPersonalWorkspaceV1Result,
  LocalPersonalWorkspaceStateV1,
  LocalPersonalWorkspaceStoreOptions,
} from './local-state/local-workspace.js'

export {
  reconcileLocalWorkspaceSoftwareV1,
} from './local-state/workspace-software-reconciliation.js'
export type {
  ReconcileLocalWorkspaceSoftwareV1Options,
  ReconcileLocalWorkspaceSoftwareV1Result,
} from './local-state/workspace-software-reconciliation.js'

export {
  inspectLocalWorkspaceProductionLifecycleV1,
  LocalWorkspaceProductionLifecycleRecoveryRequiredError,
  LocalWorkspaceProductionLifecycleStateV1Schema,
  LocalWorkspaceProductionLifecycleSummaryV1Schema,
  LocalWorkspaceProductionLifecycleWorkspaceRequiredError,
  LocalWorkspaceProductionModeV1Schema,
  setLocalWorkspaceProductionModeV1,
} from './local-state/workspace-production-lifecycle.js'
export type {
  LocalWorkspaceProductionLifecycleOptions,
  LocalWorkspaceProductionLifecycleStateV1,
  LocalWorkspaceProductionLifecycleSummaryV1,
  LocalWorkspaceProductionModeV1,
  SetLocalWorkspaceProductionModeV1Options,
  SetLocalWorkspaceProductionModeV1Result,
} from './local-state/workspace-production-lifecycle.js'

export {
  LocalWorkspaceRequiredError,
  produceLocalReviewedMeasurementV1,
} from './local-state/reviewed-measurement-producer.js'
export type {
  LocalReviewedMeasurementContextV1,
  ProduceLocalReviewedMeasurementV1Options,
  ProduceLocalReviewedMeasurementV1Result,
} from './local-state/reviewed-measurement-producer.js'

export {
  createLocalWorkspaceEvidenceExportV1,
  createNextLocalWorkspaceSignedBatchV1,
  inspectLocalWorkspaceEvidenceV1,
  LocalWorkspaceEvidenceBlockedError,
  LocalWorkspaceEvidenceExportV1Schema,
  verifyLocalWorkspaceEvidenceExportV1,
} from './local-state/workspace-evidence.js'
export type {
  CreateLocalWorkspaceEvidenceExportV1Options,
  CreateNextLocalWorkspaceSignedBatchV1Options,
  InspectLocalWorkspaceEvidenceV1Options,
  LocalWorkspaceEvidenceExportV1,
  LocalWorkspaceEvidenceStateV1,
  VerifiedLocalWorkspaceEvidenceExportV1,
} from './local-state/workspace-evidence.js'
