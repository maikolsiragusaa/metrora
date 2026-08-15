import { networkInterfaces } from 'node:os'

export type LanAddressCandidate = {
  name: string
  address: string
  internal: boolean
  family: string | number
}

function isIpv4(value: { family: string | number }): boolean {
  return value.family === 'IPv4' || value.family === 4
}

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1'
}

function privateAddressScore(address: string): number {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return 0
  if (octets[0] === 192 && octets[1] === 168) return 4
  if (octets[0] === 10) return 3
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return 2
  if (octets[0] === 169 && octets[1] === 254) return 1
  return 0
}

function isLikelyVirtualInterface(name: string): boolean {
  return /(?:docker|veth|vmware|virtual|hyper-v|tun|tap|tailscale|wireguard|vpn)/i.test(name)
}

/** Sort factual interface addresses without ever treating loopback as LAN. */
export function rankLanAddresses(candidates: LanAddressCandidate[]): string[] {
  return candidates
    .filter(candidate => !candidate.internal && isIpv4(candidate) && !isLoopback(candidate.address) && privateAddressScore(candidate.address) > 0)
    .sort((left, right) => {
      const virtualDelta = Number(isLikelyVirtualInterface(left.name)) - Number(isLikelyVirtualInterface(right.name))
      if (virtualDelta !== 0) return virtualDelta
      const privateDelta = privateAddressScore(right.address) - privateAddressScore(left.address)
      return privateDelta !== 0 ? privateDelta : left.name.localeCompare(right.name)
    })
    .map(candidate => candidate.address)
    .filter((address, index, all) => all.indexOf(address) === index)
}

export function getLanAddresses(): string[] {
  const candidates: LanAddressCandidate[] = []
  for (const [name, values] of Object.entries(networkInterfaces())) {
    for (const value of values ?? []) {
      candidates.push({
        name,
        address: value.address,
        internal: value.internal,
        family: value.family,
      })
    }
  }
  return rankLanAddresses(candidates)
}
