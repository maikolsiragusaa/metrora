// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: { name: 'Metrora', whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: class {},
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: () => {} },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}))

import { ipcChannelAliases, PROGRESS_CHANNEL, UPDATE_CHANNEL } from './main'

describe('Metrora IPC compatibility', () => {
  it('registers the canonical channel before the legacy alias', () => {
    expect(ipcChannelAliases('codeburn:getOverview')).toEqual([
      'metrora:getOverview',
      'qovrion:getOverview',
      'codeburn:getOverview',
    ])
  })

  it('does not rewrite unrelated channels', () => {
    expect(ipcChannelAliases('open-external')).toEqual(['open-external'])
  })

  it('uses Metrora for canonical push channels', () => {
    expect(PROGRESS_CHANNEL).toBe('metrora:progress')
    expect(UPDATE_CHANNEL).toBe('metrora:update')
  })
})
