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
    expect(DESKTOP_NAVIGATION_ORDER).not.toContain('plans')
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

  it('uses the pre-store task hierarchy without a standalone AI-plan destination', () => {
    expect(DESKTOP_NAVIGATION_GROUPS).toEqual([
      { id: 'home', label: null, placement: 'primary', sections: ['overview'] },
      { id: 'activity', label: 'Activity', placement: 'primary', sections: ['sessions', 'pullRequests'] },
      { id: 'analyze', label: 'Analyze', placement: 'primary', sections: ['spend', 'optimize', 'models', 'compare'] },
      { id: 'control', label: 'Control', placement: 'primary', sections: ['workspace'] },
      { id: 'product', label: 'Product', placement: 'utility', sections: ['settings'] },
    ])
    expect(DESKTOP_NAVIGATION_ORDER).toEqual([
      'overview', 'sessions', 'pullRequests', 'spend', 'optimize', 'models', 'compare', 'workspace', 'settings',
    ])
    expect(DESKTOP_NAVIGATION_ITEMS.optimize.label).toBe('Insights')
    expect(DESKTOP_NAVIGATION_ITEMS.plans.shortcut).toBe('')
    expect(DESKTOP_NAVIGATION_ITEMS.workspace.shortcut).toBe('8')
    expect(DESKTOP_NAVIGATION_ITEMS.settings.shortcut).toBe(',')
  })
})
