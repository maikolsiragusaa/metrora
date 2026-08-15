import { sanitizeError } from './quota'
import type { DesktopShareRuntime } from './share-runtime'

type ShareEnvelope = { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }
type ShareHandler = (...args: any[]) => Promise<ShareEnvelope>

function shareError(error: unknown): { kind: string; message: string } {
  return { kind: 'nonzero', message: sanitizeError(error instanceof Error ? error.message : String(error)) }
}

function pairingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error('invalid pairing id')
  return value
}

export function createShareBridgeHandlers(share: DesktopShareRuntime | null | undefined): Record<string, ShareHandler> {
  const unavailable = (): ShareEnvelope => ({ ok: false, error: { kind: 'nonzero', message: 'Desktop sharing is unavailable.' } })
  const call = (operation: (runtime: DesktopShareRuntime) => Promise<unknown>): ShareHandler => async () => {
    if (!share) return unavailable()
    try { return { ok: true, value: await operation(share) } }
    catch (error) { return { ok: false, error: shareError(error) } }
  }
  return {
    'metrora:startShare': async (always?: boolean) => call(runtime => runtime.start(always === true))(),
    'metrora:stopShare': call(runtime => runtime.stop()),
    'metrora:approvePairing': async (id?: unknown, approve?: boolean) => {
      if (!share) return unavailable()
      try { return { ok: true, value: await share.approve(pairingId(id), approve === true) } }
      catch (error) { return { ok: false, error: shareError(error) } }
    },
  }
}
