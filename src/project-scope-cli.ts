import { parseAllSessions } from './parser.js'
import { readProjectRegistry } from './project-registry.js'
import { filterProjectsByMetroraScope } from './project-scope.js'

/** Parse through the canonical collector, then apply the user-owned scope overlay. */
export async function parseProjectsForMetroraScope(range: Parameters<typeof parseAllSessions>[0], provider: string, scopeId?: string | null) {
  const registry = await readProjectRegistry()
  return filterProjectsByMetroraScope(await parseAllSessions(range, provider), registry.registry, scopeId)
}
