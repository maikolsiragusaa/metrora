import { describe, expect, it } from 'vitest'

import { DESKTOP_SECTION_CAPABILITIES } from './desktopSections'

describe('desktop section scope capabilities', () => {
  it('keeps full scope on the primary Overview payload', () => {
    expect(DESKTOP_SECTION_CAPABILITIES.overview).toMatchObject({
      period: true,
      customRange: true,
      provider: true,
      claudeConfig: true,
    })
  })

  it('does not imply that Workspace identity or evidence is filtered', () => {
    expect(DESKTOP_SECTION_CAPABILITIES.workspace).toMatchObject({
      period: false,
      customRange: false,
      provider: false,
      claudeConfig: false,
    })
  })

  it('keeps Claude config scope off reports with independent unscoped payloads', () => {
    for (const section of ['sessions', 'spend', 'optimize', 'models', 'compare'] as const) {
      expect(DESKTOP_SECTION_CAPABILITIES[section].claudeConfig).toBe(false)
    }
    expect(DESKTOP_SECTION_CAPABILITIES.pullRequests.claudeConfig).toBe(true)
  })
})
