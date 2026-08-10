import { app, dialog, ipcMain } from 'electron'
import path from 'node:path'

import { ipcChannelAliases } from './identity'
import { getDesktopWorkspaceRuntimeState, retryDesktopWorkspaceRuntime } from './local-state'
import { createWorkspaceBridgeHandlers } from './workspace'

let registered = false

export function registerWorkspaceHandlers(): void {
  if (registered) return
  registered = true
  const handlers = createWorkspaceBridgeHandlers({
    getRuntimeState: getDesktopWorkspaceRuntimeState,
    retryRuntime: retryDesktopWorkspaceRuntime,
    chooseExportPath: async suggestedName => {
      const result = await dialog.showSaveDialog({
        title: 'Export Workspace evidence',
        defaultPath: path.join(app.getPath('documents'), suggestedName),
        buttonLabel: 'Export',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      return result.canceled ? null : (result.filePath ?? null)
    },
  })
  for (const [channel, handler] of Object.entries(handlers)) {
    for (const alias of ipcChannelAliases(channel)) {
      ipcMain.handle(alias, (_event, ...args) => handler(...args))
    }
  }
}
