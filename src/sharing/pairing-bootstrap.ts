import { URL } from 'node:url'

/**
 * The QR payload is deliberately only a local bootstrap. Android still
 * performs certificate-pinned discovery, SAS comparison and Desktop approval.
 */
export function buildPairingBootstrap(host: string, port: number): string {
  const trimmedHost = host.trim()
  if (!trimmedHost || /[\s/?#]/.test(trimmedHost)) throw new Error('invalid pairing host')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('invalid pairing port')
  const uri = new URL('metrora://connect')
  uri.searchParams.set('host', trimmedHost)
  uri.searchParams.set('port', String(port))
  return uri.toString()
}
