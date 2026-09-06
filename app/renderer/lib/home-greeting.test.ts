import { describe, expect, it } from 'vitest'

import { displayNameFromWorkspaceStatus, greetingForHour } from './home-greeting'

describe('Home greeting', () => {
  it('selects the local-time greeting period', () => {
    expect(greetingForHour(6)).toBe('Good morning')
    expect(greetingForHour(12)).toBe('Good afternoon')
    expect(greetingForHour(17)).toBe('Good afternoon')
    expect(greetingForHour(18)).toBe('Good evening')
  })

  it('uses a personal workspace name without promoting bootstrap labels', () => {
    const ready = (displayName: string) => ({ availability: 'ready', snapshot: { workspace: { displayName } } })
    expect(displayNameFromWorkspaceStatus(ready('Maikol Workspace'))).toBe('Maikol')
    expect(displayNameFromWorkspaceStatus(ready('My workspace'))).toBeNull()
    expect(displayNameFromWorkspaceStatus({ availability: 'workspace-required' })).toBeNull()
  })
})
