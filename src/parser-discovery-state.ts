import { CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE } from './provider-parse-authorities.js'
import { discoverAllSessionsWithOutcomes } from './providers/index.js'
import type { SessionSource } from './providers/types.js'

export type ParserDiscoveryState = {
  sources: SessionSource[]
  complete: boolean
  providerComplete: (providerName: string) => boolean | undefined
}

export type ParserDiscoveryScope = 'all' | 'provider'

type ParserDiscoveryAuthority = {
  scope: ParserDiscoveryScope
  complete: boolean
  completeByProvider: ReadonlyMap<string, boolean>
}

let latestDiscoveryAuthority: ParserDiscoveryAuthority | null = null

function canonicalProvider(providerName: string): string {
  return CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE[providerName] ?? providerName
}

/**
 * Return the most recent fresh parser discovery result for one canonical
 * provider. `undefined` means that provider was not part of the most recent
 * discovery (or no fresh discovery has run); callers keep their conservative
 * behavior then.
 */
export function latestParserDiscoveryProviderComplete(providerName: string): boolean | undefined {
  return latestDiscoveryAuthority?.completeByProvider.get(canonicalProvider(providerName))
}

export function hasLatestParserDiscoveryAuthority(): boolean {
  return latestDiscoveryAuthority !== null
}

export function latestParserDiscoveryComplete(): boolean | undefined {
  return latestDiscoveryAuthority?.complete
}

/** True/false for a completed all-provider discovery; undefined when the most
 * recent discovery was provider-scoped or no fresh discovery has run. */
export function latestParserDiscoveryGlobalComplete(): boolean | undefined {
  return latestDiscoveryAuthority?.scope === 'all' ? latestDiscoveryAuthority.complete : undefined
}

export async function resolveParserDiscovery(providerFilter?: string, cachedOnly = false): Promise<ParserDiscoveryState> {
  if (cachedOnly) return { sources: [], complete: true, providerComplete: () => false }
  const discovery = await discoverAllSessionsWithOutcomes(providerFilter)
  const completeByProvider = new Map(discovery.outcomes.map(outcome => [outcome.provider, outcome.complete]))
  latestDiscoveryAuthority = {
    scope: providerFilter && providerFilter !== 'all' ? 'provider' : 'all',
    complete: discovery.complete,
    completeByProvider,
  }
  return {
    sources: discovery.sources,
    complete: discovery.complete,
    providerComplete: providerName => completeByProvider.get(canonicalProvider(providerName)),
  }
}
