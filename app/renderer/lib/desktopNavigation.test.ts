import { describe, expect, it } from 'vitest'

import {
  DESKTOP_NAVIGATION_GROUPS,
  DESKTOP_NAVIGATION_ITEMS,
  DESKTOP_NAVIGATION_ORDER,
  SECTION_BY_SHORTCUT,
  SECTION_IDS,
  SECTION_TITLES,
} from './desktopNavigation'

describe('desktop navigation authority', () => {
  it('keeps every visible destination unique while allowing internal routable sections', () => {
    expect(new Set(DESKTOP_NAVIGATION_ORDER).size).toBe(DESKTOP_NAVIGATION_ORDER.length)
    expect(DESKTOP_NAVIGATION_ORDER.every(id => SECTION_IDS.includes(id))).toBe(true)
    expect(DESKTOP_NAVIGATION_ORDER).toContain('plans')
    expect(SECTION_IDS).toContain('plans')
  })

  it('owns labels and titles for every routable section and shortcuts only for visible destinations', () => {
    for (const id of SECTION_IDS) {
      const item = DESKTOP_NAVIGATION_ITEMS[id]
      expect(item.id).toBe(id)
      expect(item.label).not.toBe('')
      expect(SECTION_TITLES[id]).toBe(item.title)
      if (item.shortcut) expect(SECTION_BY_SHORTCUT[item.shortcut]).toBe(id)
      else expect(Object.values(SECTION_BY_SHORTCUT)).not.toContain(id)
    }
  })

  it('exposes the control-center destinations while retaining internal routes', () => {
    expect(DESKTOP_NAVIGATION_GROUPS).toEqual([
      { id: 'home', label: null, placement: 'primary', sections: ['overview'] },
      { id: 'primary', label: null, placement: 'primary', sections: ['sessions', 'models', 'spend', 'plans', 'bench', 'workspace', 'code'] },
      { id: 'utility', label: null, placement: 'utility', sections: ['companion', 'settings'] },
    ])
    expect(DESKTOP_NAVIGATION_ORDER).toEqual([
      'overview', 'sessions', 'models', 'spend', 'plans', 'bench', 'workspace', 'code', 'companion', 'settings',
    ])
    expect(DESKTOP_NAVIGATION_ORDER).not.toContain('optimize')
    expect(DESKTOP_NAVIGATION_ORDER).not.toContain('compare')
    expect(DESKTOP_NAVIGATION_ORDER).not.toContain('activity')
    expect(DESKTOP_NAVIGATION_ORDER).not.toContain('pullRequests')
    expect(DESKTOP_NAVIGATION_ITEMS.optimize.label).toBe('Insights')
    expect(DESKTOP_NAVIGATION_ITEMS.code.label).toBe('Code')
    expect(DESKTOP_NAVIGATION_ITEMS.bench.title).toBe('Local Bench')
    expect(DESKTOP_NAVIGATION_ITEMS.plans.id).toBe('plans')
    expect(DESKTOP_NAVIGATION_ITEMS.plans.label).toBe('Capacity')
    expect(DESKTOP_NAVIGATION_ITEMS.plans.shortcut).toBe('6')
    expect(DESKTOP_NAVIGATION_ITEMS.sessions.shortcut).toBe('2')
    expect(DESKTOP_NAVIGATION_ITEMS.activity.shortcut).toBe('')
    expect(DESKTOP_NAVIGATION_ITEMS.workspace.shortcut).toBe('7')
    expect(DESKTOP_NAVIGATION_ITEMS.companion.label).toBe('Companion')
    expect(DESKTOP_NAVIGATION_ITEMS.settings.shortcut).toBe(',')
  })
})
