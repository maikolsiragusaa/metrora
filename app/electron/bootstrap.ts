import { app, safeStorage } from 'electron'

import {
  disposeDesktopWorkspaceRuntime,
  initializeDesktopWorkspaceRuntimeState,
  installDesktopWorkspaceRuntimePromise,
} from './local-state'

// Install the promise before loading the inherited desktop main module. IPC
// handlers can therefore await the same one-time OS-vault initialization even
// when the window is created before it settles. Failure never opens a plaintext
// fallback and never blocks the existing local analytics dashboard.
const workspaceRuntimePromise = app.whenReady().then(() => initializeDesktopWorkspaceRuntimeState({
  platform: process.platform,
  arch: process.arch,
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  userDataPath: app.getPath('userData'),
  safeStorage,
}))
installDesktopWorkspaceRuntimePromise(workspaceRuntimePromise)

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