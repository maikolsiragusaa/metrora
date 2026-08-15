import { describe, expect, it } from 'vitest'

import { buildPairingBootstrap } from './pairing-bootstrap.js'

describe('Desktop pairing bootstrap', () => {
  it('emits the bounded payload Android parses as a local connection endpoint', () => {
    const payload = buildPairingBootstrap('desktop.local', 7777)
    const parsed = new URL(payload)

    expect(parsed.protocol).toBe('metrora:')
    expect(parsed.hostname).toBe('connect')
    expect(parsed.searchParams.get('host')).toBe('desktop.local')
    expect(parsed.searchParams.get('port')).toBe('7777')
    expect(payload).toBe('metrora://connect?host=desktop.local&port=7777')
  })

  it('rejects unsafe or invalid endpoint fields', () => {
    expect(() => buildPairingBootstrap('https://desktop.local', 7777)).toThrow('invalid pairing host')
    expect(() => buildPairingBootstrap('desktop.local', 0)).toThrow('invalid pairing port')
  })
})
