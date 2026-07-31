// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: { name: 'Qovrion', whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: () => {} },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}))

import { ipcChannelAliases, PROGRESS_CHANNEL, UPDATE_CHANNEL } from './main'

describe('Qovrion IPC compatibility', () => {
  it('registers the canonical channel before the legacy alias', () => {
    expect(ipcChannelAliases('codeburn:getOverview')).toEqual([
      'qovrion:getOverview',
      'codeburn:getOverview',
    ])
  })

  it('does not rewrite unrelated channels', () => {
    expect(ipcChannelAliases('open-external')).toEqual(['open-external'])
  })

  it('uses Qovrion for canonical push channels', () => {
    expect(PROGRESS_CHANNEL).toBe('qovrion:progress')
    expect(UPDATE_CHANNEL).toBe('qovrion:update')
  })
})
