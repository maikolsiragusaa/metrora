/**
 * Swarm is intentionally not a production-default surface yet.
 *
 * Vite development builds are founder-enabled. A production build can only
 * opt in explicitly through the bounded VITE flag.
 */
export function isSwarmExperimentalEnabled(): boolean {
  return Boolean(import.meta.env.DEV || import.meta.env.VITE_METRORA_SWARM_EXPERIMENTAL === '1')
}
