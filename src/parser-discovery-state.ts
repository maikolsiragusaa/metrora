import { CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE } from './provider-parse-authorities.js'
import { discoverAllSessionsWithOutcomes } from './providers/index.js'
import type { SessionSource } from './providers/types.js'

export type ParserDiscoveryState = {
  sources: SessionSource[]
  complete: boolean
  providerComplete: (providerName: string) => boolean
}

export async function resolveParserDiscovery(providerFilter?: string, cachedOnly = false): Promise<ParserDiscoveryState> {
  if (cachedOnly) return { sources: [], complete: true, providerComplete: () => false }
  const discovery = await discoverAllSessionsWithOutcomes(providerFilter)
  const completeByProvider = new Map(discovery.outcomes.map(outcome => [outcome.provider, outcome.complete]))
  return {
    sources: discovery.sources,
    complete: discovery.complete,
    providerComplete: providerName => completeByProvider.get(CANONICAL_COLLECTOR_BY_STORAGE_NAMESPACE[providerName] ?? providerName) === true,
  }
}
