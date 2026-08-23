import { SECTION_TITLES, type Section } from './desktopNavigation'
import type { Period } from './types'

export { SECTION_TITLES }

export type DesktopSectionCapabilities = {
  period: boolean
  customRange: boolean
  provider: boolean
  claudeConfig: boolean
  globalRefresh: boolean
}

export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'This month',
  '30days': 'Last 30 days',
  all: 'Last 6 months',
  lifetime: 'Lifetime',
}

const FULL_ANALYTICS_SCOPE: DesktopSectionCapabilities = {
  period: true,
  customRange: true,
  provider: true,
  claudeConfig: false,
  globalRefresh: true,
}

export const DESKTOP_SECTION_CAPABILITIES: Record<Section, DesktopSectionCapabilities> = {
  overview: { ...FULL_ANALYTICS_SCOPE, claudeConfig: true },
  sessions: FULL_ANALYTICS_SCOPE,
  pullRequests: { ...FULL_ANALYTICS_SCOPE, claudeConfig: true },
  spend: FULL_ANALYTICS_SCOPE,
  optimize: FULL_ANALYTICS_SCOPE,
  models: FULL_ANALYTICS_SCOPE,
  compare: FULL_ANALYTICS_SCOPE,
  advisor: FULL_ANALYTICS_SCOPE,
  plans: {
    period: false,
    customRange: false,
    provider: false,
    claudeConfig: false,
    globalRefresh: true,
  },
  workspace: {
    period: false,
    customRange: false,
    provider: false,
    claudeConfig: false,
    globalRefresh: true,
  },
  settings: {
    period: false,
    customRange: false,
    provider: false,
    claudeConfig: false,
    globalRefresh: true,
  },
}
