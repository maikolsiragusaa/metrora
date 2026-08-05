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
  it('includes every section exactly once', () => {
    expect(DESKTOP_NAVIGATION_ORDER).toHaveLength(SECTION_IDS.length)
    expect(new Set(DESKTOP_NAVIGATION_ORDER).size).toBe(SECTION_IDS.length)
    expect([...DESKTOP_NAVIGATION_ORDER].sort()).toEqual([...SECTION_IDS].sort())
  })

  it('owns labels, titles, groups, and shortcut routing from one map', () => {
    for (const id of SECTION_IDS) {
      const item = DESKTOP_NAVIGATION_ITEMS[id]
      expect(item.id).toBe(id)
      expect(item.label).not.toBe('')
      expect(SECTION_TITLES[id]).toBe(item.title)
      expect(SECTION_BY_SHORTCUT[item.shortcut]).toBe(id)
    }
  })

  it('prototypes a task-oriented hierarchy while keeping shortcuts in scan order', () => {
    expect(DESKTOP_NAVIGATION_GROUPS).toEqual([
      { id: 'home', label: null, placement: 'primary', sections: ['overview'] },
      { id: 'activity', label: 'Activity', placement: 'primary', sections: ['sessions', 'pullRequests'] },
      { id: 'analyze', label: 'Analyze', placement: 'primary', sections: ['spend', 'optimize', 'models', 'compare'] },
      { id: 'control', label: 'Control', placement: 'primary', sections: ['plans', 'workspace'] },
      { id: 'product', label: 'Product', placement: 'utility', sections: ['settings'] },
    ])
    expect(DESKTOP_NAVIGATION_ORDER).toEqual(SECTION_IDS)
    expect(DESKTOP_NAVIGATION_ITEMS.overview.label).toBe('Home')
    expect(DESKTOP_NAVIGATION_ITEMS.settings.shortcut).toBe(',')
  })
})
