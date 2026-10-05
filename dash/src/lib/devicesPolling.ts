import type { DevicesResponse } from '@/lib/api'

/**
 * Polling cadence for the devices query. The server answers instantly from its
 * last-good payload while it rebuilds in the background (stale-while-revalidate):
 * keep polling fast until it reports fresh data, then fall back to the pairing
 * cadence so a paired device that briefly dropped (asleep/network blip)
 * reappears on its own instead of staying gone until you switch tabs.
 */
export function deviceRefetchInterval(query: { state: { data?: DevicesResponse | undefined } }): number | false {
  if (query.state.data?.stale) return 2500
  return query.state.data?.devices?.some((d) => !d.local) ? 20000 : false
}
