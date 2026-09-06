export const SECTION_IDS = [
  'overview',
  'activity',
  'sessions',
  'pullRequests',
  'spend',
  'optimize',
  'models',
  'compare',
  'code',
  'bench',
  'plans',
  'workspace',
  'companion',
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
  id: 'home' | 'primary' | 'utility'
  label: string | null
  placement: 'primary' | 'utility'
  sections: readonly Section[]
}

export const DESKTOP_NAVIGATION_ITEMS: Record<Section, DesktopNavigationItem> = {
  overview: { id: 'overview', label: 'Home', title: 'Home', shortcut: '1' },
  activity: { id: 'activity', label: 'Activity', title: 'Activity', shortcut: '2' },
  sessions: { id: 'sessions', label: 'Sessions', title: 'Sessions', shortcut: '' },
  pullRequests: { id: 'pullRequests', label: 'Pull requests', title: 'Pull requests', shortcut: '' },
  spend: { id: 'spend', label: 'Spend', title: 'Spend', shortcut: '3' },
  optimize: { id: 'optimize', label: 'Insights', title: 'Insights', shortcut: '' },
  models: { id: 'models', label: 'Models', title: 'Models', shortcut: '4' },
  compare: { id: 'compare', label: 'Compare', title: 'Compare', shortcut: '' },
  code: { id: 'code', label: 'Code', title: 'Code', shortcut: '' },
  bench: { id: 'bench', label: 'Bench', title: 'Local Bench', shortcut: '5' },
  plans: { id: 'plans', label: 'Capacity', title: 'Provider plans', shortcut: '6' },
  workspace: { id: 'workspace', label: 'Workspace', title: 'Personal workspace', shortcut: '7' },
  companion: { id: 'companion', label: 'Companion', title: 'Metrora Companion', shortcut: '' },
  settings: { id: 'settings', label: 'Settings', title: 'Settings', shortcut: ',' },
}

export const DESKTOP_NAVIGATION_GROUPS: readonly DesktopNavigationGroup[] = [
  { id: 'home', label: null, placement: 'primary', sections: ['overview'] },
  { id: 'primary', label: null, placement: 'primary', sections: ['activity', 'models', 'spend', 'plans', 'bench', 'workspace', 'code'] },
  { id: 'utility', label: null, placement: 'utility', sections: ['companion', 'settings'] },
]

export const DESKTOP_NAVIGATION_ORDER: readonly Section[] = DESKTOP_NAVIGATION_GROUPS.flatMap(group => group.sections)
export const SECTION_TITLES: Record<Section, string> = Object.fromEntries(SECTION_IDS.map(id => [id, DESKTOP_NAVIGATION_ITEMS[id].title])) as Record<Section, string>
export const SECTION_BY_SHORTCUT: Readonly<Record<string, Section>> = Object.fromEntries(
  DESKTOP_NAVIGATION_ORDER.map(id => [DESKTOP_NAVIGATION_ITEMS[id].shortcut, id] as const).filter(([shortcut]) => shortcut.length > 0),
)
