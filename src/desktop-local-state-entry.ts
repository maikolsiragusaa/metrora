// Narrow runtime entry loaded by Electron's main process. It deliberately
// exposes only desktop-host initialization; raw private identity material never
// crosses into the renderer or an IPC response.
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
