// Renderer-safe mirror of CompanionCapabilitiesV1
// (src/sharing/capability-contract.ts). The renderer is a pure view over the
// Desktop share runtime, so this shape must match the canonical authority.
// Do not invent fields — copy from the cited source file.

export type CompanionCapabilityId =
  | 'home.usage'
  | 'home.capacity'
  | 'projects'
  | 'activity.sessions'
  | 'activity.pullRequests'
  | 'analyze.models'
  | 'analyze.spend'
  | 'workspace'
  | 'device.settings'

export type CompanionCapabilityV1 = {
  id: CompanionCapabilityId
  versions: number[]
  availability: 'available' | 'unavailable'
  freshness: 'live' | 'cached' | 'unknown'
  scopes: { period: boolean; project: boolean; workspace: boolean }
  reason?: 'not-implemented' | 'no-authority' | 'unsupported'
}

export type CompanionCapabilitiesV1 = {
  kind: 'metrora.companion.capabilities'
  version: 1
  generatedAt: string
  capabilities: CompanionCapabilityV1[]
}
