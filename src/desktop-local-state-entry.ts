// Narrow runtime entry loaded by Electron's main process. It deliberately
// exposes only desktop-host initialization and public local-workspace records;
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
