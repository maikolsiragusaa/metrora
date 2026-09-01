import { periodLabel, scopeLabel } from '../advisor/evidence'
import type { AdvisorContextualScopeMode } from '../advisor/context'
import type { AdvisorScope } from '../advisor/types'

function providerLabel(provider: string): string {
  if (provider === 'all') return 'All providers'
  return provider.split(/[-\s]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function contextualScopeLabel(scope: AdvisorScope, mode: AdvisorContextualScopeMode | null): string {
  if (mode === 'capacity') return 'Provider-reported current capacity · All providers'
  if (mode === 'compare') return `Compare page scope · ${periodLabel(scope)} · ${providerLabel(scope.provider)}`
  return scopeLabel(scope)
}
