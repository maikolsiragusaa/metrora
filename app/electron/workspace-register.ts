import { app, dialog, ipcMain } from 'electron'
import path from 'node:path'

import { getDesktopWorkspaceRuntimeState } from './local-state'
import { createWorkspaceBridgeHandlers } from './workspace'

function aliases(channel: string): string[] {
  if (!channel.startsWith('codeburn:')) return [channel]
  return [
    channel.replace(/^codeburn:/, 'metrora:'),
    channel.replace(/^codeburn:/, 'qovrion:'),
    channel,
  ]
}

let registered = false

export function registerWorkspaceHandlers(): void {
  if (registered) return
  registered = true
  const handlers = createWorkspaceBridgeHandlers({
    getRuntimeState: getDesktopWorkspaceRuntimeState,
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
    for (const alias of aliases(channel)) {
      ipcMain.handle(alias, (_event, ...args) => handler(...args))
    }
  }
}