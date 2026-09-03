import { appendFileSync } from 'node:fs'

const marker = process.argv[2] || ''
let buffer = ''

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function toolList() {
  return [{
    name: 'echo',
    description: 'Echo one bounded test value.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
  }]
}

function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return
  if (message.method === 'notifications/initialized') return
  if (message.method === 'initialize') {
    reply(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'metrora-stdio-fixture', version: '1.0.0' },
    })
    return
  }
  if (message.method === 'ping') { reply(message.id, {}); return }
  if (message.method === 'tools/list') { reply(message.id, { tools: toolList() }); return }
  if (message.method === 'tools/call') {
    const value = message.params?.arguments?.value
    if (typeof value !== 'string' || value.length > 240) { error(message.id, -32602, 'value is invalid'); return }
    if (marker) {
      try { appendFileSync(marker, `${value}\n`, { encoding: 'utf8' }) } catch { /* fixture marker is best effort */ }
    }
    reply(message.id, { content: [{ type: 'text', text: `fixture echo: ${value}` }], isError: false })
    return
  }
  if (message.method === 'shutdown') { reply(message.id, {}); return }
  if (message.id !== undefined) error(message.id, -32601, `Unknown MCP method: ${String(message.method)}`)
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      try { handle(JSON.parse(line)) } catch { /* malformed input is ignored by the fixture */ }
    }
    newline = buffer.indexOf('\n')
  }
})
