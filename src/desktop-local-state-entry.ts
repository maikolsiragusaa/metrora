// Narrow runtime entry loaded by Electron's main process. It deliberately
// exposes desktop-host initialization and public local-workspace/outbox records;
// raw private identity material never crosses into the renderer or an IPC response.
export {
  DesktopVaultUnavailableError,
  initializeDesktopLocalStateV1,
} from './local-state/desktop-host.js'
export type {
  DesktopSafeStorageProvider,
  DesktopVaultBackendV1,
  InitializedDesktopLocalStateV1,
  InitializeDesktopLocalStateV1Options,
} from './local-state/desktop-host.js'

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