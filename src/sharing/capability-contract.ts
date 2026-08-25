export const COMPANION_CAPABILITY_KIND = 'metrora.companion.capabilities' as const
export const COMPANION_CAPABILITY_VERSION = 1 as const

export const COMPANION_CAPABILITY_IDS = [
  'home.usage',
  'home.capacity',
  'projects',
  'activity.sessions',
  'activity.pullRequests',
  'analyze.models',
  'analyze.spend',
  'workspace',
  'device.settings',
] as const
export type CompanionCapabilityId = typeof COMPANION_CAPABILITY_IDS[number]
export type CapabilityAvailability = 'available' | 'unavailable'
export type CapabilityFreshness = 'live' | 'cached' | 'unknown'

export type CompanionCapabilityV1 = {
  id: CompanionCapabilityId
  versions: number[]
  availability: CapabilityAvailability
  freshness: CapabilityFreshness
  scopes: {
    period: boolean
    project: boolean
    workspace: boolean
  }
  reason?: 'not-implemented' | 'no-authority' | 'unsupported'
}

export type CompanionCapabilitiesV1 = {
  kind: typeof COMPANION_CAPABILITY_KIND
  version: typeof COMPANION_CAPABILITY_VERSION
  generatedAt: string
  capabilities: CompanionCapabilityV1[]
}

export type CompanionDomainEnvelopeV1<T> = {
  capability: CompanionCapabilityId
  version: 1
  available: boolean
  freshness: CapabilityFreshness
  scope: {
    projectId: string
    period: string
    workspace: 'local' | 'unavailable'
  }
  data: T | null
}

/** The public capability matrix is factual: Workspace has no bounded mobile projection in V1. */
export function buildCompanionCapabilitiesV1(
  generatedAt = new Date().toISOString(),
  options: { capacityAvailable?: boolean } = {},
): CompanionCapabilitiesV1 {
  const available = new Set<CompanionCapabilityId>([
    'home.usage',
    'projects',
    'activity.sessions',
    'activity.pullRequests',
    'analyze.models',
    'analyze.spend',
    'device.settings',
  ])
  if (options.capacityAvailable) available.add('home.capacity')
  return {
    kind: COMPANION_CAPABILITY_KIND,
    version: COMPANION_CAPABILITY_VERSION,
    generatedAt,
    capabilities: COMPANION_CAPABILITY_IDS.map(id => ({
      id,
      versions: [1],
      availability: available.has(id) ? 'available' : 'unavailable',
      // Discovery reports support and scope. Instance freshness belongs to the
      // domain envelope/foundation response, so discovery cannot claim cached
      // or live data for a capability it has not fetched.
      freshness: 'unknown',
      scopes: {
        period: id !== 'projects' && id !== 'device.settings' && id !== 'home.capacity',
        project: id !== 'device.settings' && id !== 'home.capacity',
        workspace: false,
      },
      ...(id === 'workspace' ? { reason: 'no-authority' as const } : {}),
    })),
  }
}

export function negotiateCapabilityVersion(
  discovery: CompanionCapabilitiesV1,
  id: CompanionCapabilityId,
  supportedVersions: readonly number[] = [1],
): number | null {
  const capability = discovery.capabilities.find(value => value.id === id)
  if (!capability || capability.availability !== 'available') return null
  return capability.versions.find(version => supportedVersions.includes(version)) ?? null
}

export function isCompanionCapabilitiesV1(value: unknown): value is CompanionCapabilitiesV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const root = value as Record<string, unknown>
  return root.kind === COMPANION_CAPABILITY_KIND && root.version === COMPANION_CAPABILITY_VERSION && Array.isArray(root.capabilities)
}
