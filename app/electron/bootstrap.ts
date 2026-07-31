import { app, safeStorage } from 'electron'

import { initializeDesktopEndpointState } from './local-state'

// Register this before loading the inherited desktop main module. The endpoint
// identity is prepared as soon as Electron is ready, but failure never opens a
// plaintext fallback and never blocks the current local-only dashboard.
void app.whenReady().then(async () => {
  try {
    await initializeDesktopEndpointState({
      platform: process.platform,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      safeStorage,
    })
  } catch (error) {
    // Do not print OS-vault errors or paths. Sync remains disabled, so the safe
    // fallback is to continue as the existing local-only desktop.
    const kind = error instanceof Error ? error.name : 'UnknownError'
    console.error(`local endpoint state unavailable (${kind}); continuing local-only`)
  }
})

void import('./main.js').catch(error => {
  console.error('desktop main bootstrap failed:', error)
  app.quit()
})
