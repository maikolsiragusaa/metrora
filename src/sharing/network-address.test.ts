import { describe, expect, it } from 'vitest'

import { rankLanAddresses, type LanAddressCandidate } from './network-address.js'

describe('LAN address selection', () => {
  it('prefers a factual non-virtual private LAN address and never returns loopback', () => {
    const candidates: LanAddressCandidate[] = [
      { name: 'Loopback', address: '127.0.0.1', internal: true, family: 'IPv4' },
      { name: 'VPN', address: '10.10.0.4', internal: false, family: 'IPv4' },
      { name: 'vEthernet (Docker)', address: '192.168.65.1', internal: false, family: 'IPv4' },
      { name: 'Wi-Fi', address: '192.168.1.24', internal: false, family: 'IPv4' },
      { name: 'Public', address: '198.51.100.24', internal: false, family: 'IPv4' },
      { name: 'IPv6', address: 'fe80::1', internal: false, family: 'IPv6' },
    ]

    expect(rankLanAddresses(candidates)).toEqual(['192.168.1.24', '192.168.65.1', '10.10.0.4'])
  })
})
