import { connect } from 'node:tls'

import { describe, expect, it } from 'vitest'

import { generateIdentity } from './identity.js'
import { PeerStore } from './pairing.js'
import { companionPairRequest } from './client.js'
import { parseShareRequestUrl, ShareServer } from './share-server.js'

function rawTlsRequest(
  port: number,
  identity: Awaited<ReturnType<typeof generateIdentity>>,
  target: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: '127.0.0.1',
      port,
      key: identity.key,
      cert: identity.cert,
      rejectUnauthorized: false,
    })
    let response = ''
    socket.setEncoding('utf8')
    socket.setTimeout(1_500, () => socket.destroy(new Error('sharing request timed out')))
    socket.on('secureConnect', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    })
    socket.on('data', chunk => { response += chunk })
    socket.on('end', () => resolve(response))
    socket.on('error', reject)
  })
}

describe('sharing request URL error boundary', () => {
  it('classifies the request-target matrix without changing valid URL semantics', () => {
    expect(parseShareRequestUrl('/api/peer/hello').pathname).toBe('/api/peer/hello')
    expect(parseShareRequestUrl(`https://localhost/api/peer/hello?value=${'a'.repeat(8_000)}`).pathname)
      .toBe('/api/peer/hello')

    for (const target of [
      'ftp://example.test/api/peer/hello',
      'https://%zz/api/peer/hello',
      'http://[',
      '',
      '   ',
    ]) {
      expect(() => parseShareRequestUrl(target)).toThrow('invalid sharing request URL')
    }
  })

  it('returns a deterministic client error for a malformed absolute request target', async () => {
    const serverIdentity = await generateIdentity('Metrora desktop')
    const clientIdentity = await generateIdentity('Metrora companion')
    const server = new ShareServer({
      identity: serverIdentity,
      peers: new PeerStore(),
      getUsage: async () => ({}),
    })
    const port = await server.listen(0, '127.0.0.1')

    try {
      const response = await rawTlsRequest(port, clientIdentity, 'http://[')
      expect(response).toContain('HTTP/1.1 400')
      expect(response).toContain('{"error":"invalid sharing request URL"}')
      expect(response).not.toContain('Invalid URL')
    } finally {
      await server.close()
    }
  })

  it('returns the same deterministic client error for an unsupported protocol', async () => {
    const serverIdentity = await generateIdentity('Metrora desktop')
    const clientIdentity = await generateIdentity('Metrora companion')
    const server = new ShareServer({
      identity: serverIdentity,
      peers: new PeerStore(),
      getUsage: async () => ({}),
    })
    const port = await server.listen(0, '127.0.0.1')

    try {
      const response = await rawTlsRequest(port, clientIdentity, 'ftp://example.test/api/peer/hello')
      expect(response).toContain('HTTP/1.1 400')
      expect(response).toContain('{"error":"invalid sharing request URL"}')
    } finally {
      await server.close()
    }
  })

  it('preserves the existing route-failure boundary after valid URL parsing', async () => {
    const serverIdentity = await generateIdentity('Metrora desktop')
    const clientIdentity = await generateIdentity('Metrora companion')
    const server = new ShareServer({
      identity: serverIdentity,
      peers: new PeerStore(),
      getUsage: async () => ({}),
      approve: async () => { throw new Error('simulated request failure') },
    })
    const port = await server.listen(0, '127.0.0.1')

    try {
      const response = await companionPairRequest({ identity: clientIdentity, host: '127.0.0.1', port }, 'Companion')
      expect(response.status).toBe(500)
      expect(response.json).toEqual({ error: 'simulated request failure' })
    } finally {
      await server.close()
    }
  })
})
