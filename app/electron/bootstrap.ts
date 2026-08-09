import { app, safeStorage } from 'electron'

import {
  disposeDesktopWorkspaceRuntime,
  initializeDesktopWorkspaceRuntimeState,
  installDesktopWorkspaceRuntimePromise,
} from './local-state'
import { registerWorkspaceHandlers } from './workspace-register'

// Install the promise before loading the inherited desktop main module. IPC
// handlers can therefore await the same OS-vault initialization even when the
// window is created before it settles. A failed attempt can be replaced by the
// explicit status retry without opening a plaintext fallback or blocking the
// existing local analytics dashboard.
const initializeWorkspaceRuntime = () => app.whenReady().then(() => initializeDesktopWorkspaceRuntimeState({
  platform: process.platform,
  arch: process.arch,
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  userDataPath: app.getPath('userData'),
  safeStorage,
}))
const workspaceRuntimePromise = initializeWorkspaceRuntime()
installDesktopWorkspaceRuntimePromise(workspaceRuntimePromise, initializeWorkspaceRuntime)
registerWorkspaceHandlers()

void workspaceRuntimePromise.then(state => {
  if (state.status === 'ready' || state.status === 'unsupported-platform') return
  console.error(`local Workspace runtime unavailable (${state.reason}); continuing with local analytics`)
})

app.on('before-quit', () => {
  void disposeDesktopWorkspaceRuntime()
})

void import('./main.js').catch(error => {
  console.error('desktop main bootstrap failed:', error)
  app.quit()
})
