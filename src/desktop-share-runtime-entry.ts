import { loadPricing } from './models.js'
import { ShareController, type ShareStatus } from './sharing/share-controller.js'
import { buildCompanionCapabilities, buildCompanionFoundation, buildCompanionUsage } from './sharing/share-run.js'
import { loadShareAlways } from './sharing/store.js'

export type DesktopShareRuntimeV1 = {
  status(): Promise<ShareStatus>
  start(always: boolean): Promise<ShareStatus>
  stop(): Promise<ShareStatus>
  approve(id: string, approve: boolean): Promise<ShareStatus>
}

/**
 * The Electron surface owns one ShareController instance through this entry
 * point. QR/bootstrap, pairing approval, mTLS, and usage authority remain in
 * src/sharing/*; this adapter only exposes the existing controller lifecycle.
 */
export async function createDesktopShareRuntime(port = 7777): Promise<DesktopShareRuntimeV1> {
  let pricingReady: Promise<void> | null = null
  const ensurePricing = (): Promise<void> => pricingReady ??= loadPricing()
  const share = new ShareController(
    query => buildCompanionUsage(query),
    port,
    () => buildCompanionCapabilities(),
    query => buildCompanionFoundation(query),
  )

  if (await loadShareAlways()) {
    await ensurePricing()
    await share.start(true).catch(() => {})
  }

  return {
    status: () => share.status(),
    start: async (always) => {
      await ensurePricing()
      await share.start(always)
      return share.status()
    },
    stop: async () => {
      await share.stop()
      return share.status()
    },
    approve: async (id, approve) => {
      share.resolvePending(id, approve)
      return share.status()
    },
  }
}
