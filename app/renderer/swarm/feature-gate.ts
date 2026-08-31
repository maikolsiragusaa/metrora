/**
 * Swarm is a public, manual execution strategy. Keep one explicit kill switch
 * for staged deployments, but do not ship a misleading "Soon" state by
 * default now that the bounded lifecycle is part of the product surface.
 */
export function isSwarmExperimentalEnabled(): boolean {
  return import.meta.env.VITE_METRORA_SWARM_EXPERIMENTAL !== '0'
}
