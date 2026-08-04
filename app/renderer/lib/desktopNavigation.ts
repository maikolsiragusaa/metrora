export const SECTION_IDS = [
  'overview',
  'sessions',
  'pullRequests',
  'spend',
  'optimize',
  'models',
  'compare',
  'plans',
  'workspace',
  'settings',
] as const

export type Section = typeof SECTION_IDS[number]

export type DesktopNavigationItem = {
  id: Section
  label: string
  title: string
  shortcut: string
}

export type DesktopNavigationGroup = {
  id: 'home' | 'analyze' | 'improve' | 'trust' | 'product'
  label: string | null
  placement: 'primary' | 'utility'
  sections: readonly Section[]
}

export const DESKTOP_NAVIGATION_ITEMS: Record<Section, DesktopNavigationItem> = {
  overview: { id: 'overview', label: 'Home', title: 'Home', shortcut: '1' },
  sessions: { id: 'sessions', label: 'Sessions', title: 'Sessions', shortcut: '2' },
  pullRequests: { id: 'pullRequests', label: 'Pull requests', title: 'Pull requests', shortcut: '3' },
  spend: { id: 'spend', label: 'Spend', title: 'Spend', shortcut: '4' },
  optimize: { id: 'optimize', label: 'Optimize', title: 'Optimize', shortcut: '5' },
  models: { id: 'models', label: 'Models', title: 'Models', shortcut: '6' },
  compare: { id: 'compare', label: 'Compare', title: 'Compare', shortcut: '7' },
  plans: { id: 'plans', label: 'Plans', title: 'Plans', shortcut: '8' },
  workspace: { id: 'workspace', label: 'Workspace', title: 'Workspace', shortcut: '9' },
  settings: { id: 'settings', label: 'Settings', title: 'Settings', shortcut: ',' },
}

export const DESKTOP_NAVIGATION_GROUPS: readonly DesktopNavigationGroup[] = [
  { id: 'home', label: null, placement: 'primary', sections: ['overview'] },
  { id: 'analyze', label: 'Analyze', placement: 'primary', sections: ['sessions', 'pullRequests', 'spend', 'models', 'compare'] },
  { id: 'improve', label: 'Improve', placement: 'primary', sections: ['optimize', 'plans'] },
  { id: 'trust', label: 'Trust', placement: 'primary', sections: ['workspace'] },
  { id: 'product', label: 'Product', placement: 'utility', sections: ['settings'] },
]

export const DESKTOP_NAVIGATION_ORDER: readonly Section[] = DESKTOP_NAVIGATION_GROUPS.flatMap(group => group.sections)

export const SECTION_TITLES: Record<Section, string> = Object.fromEntries(
  SECTION_IDS.map(id => [id, DESKTOP_NAVIGATION_ITEMS[id].title]),
) as Record<Section, string>

export const SECTION_BY_SHORTCUT: Readonly<Record<string, Section>> = Object.fromEntries(
  SECTION_IDS.map(id => [DESKTOP_NAVIGATION_ITEMS[id].shortcut, id]),
)
