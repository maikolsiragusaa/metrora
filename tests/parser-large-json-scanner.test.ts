import { describe, expect, it } from 'vitest'

import { parseJsonlLine } from '../src/parser.js'

function largeUserLine(): string {
  return JSON.stringify({
    type: 'user',
    sessionId: 's1',
    timestamp: '2026-05-01T00:00:00Z',
    cwd: '/repo',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { data: 'x'.repeat(40_000) } },
        { type: 'text', text: 'hello ' + 'a'.repeat(3000) },
      ],
    },
  })
}

function largeAssistantLine(): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    timestamp: '2026-05-01T00:00:01Z',
    cwd: '/repo',
    message: {
      id: 'm1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [
        { type: 'text', text: 'x'.repeat(40_000) },
        { type: 'tool_use', id: 'read1', name: 'Read', input: { file_path: '/tmp/file.ts', content: 'drop me' } },
        { type: 'tool_use', id: 'agent1', name: 'Agent', input: { subagent_type: 'reviewer', prompt: 'drop me' } },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 300,
      },
    },
  })
}

describe('large JSONL compact scanner', () => {
  it('extracts user text from array content without full JSON.parse', () => {
    const parsed = parseJsonlLine(largeUserLine())
    expect(parsed?.type).toBe('user')
    const content = parsed?.message?.role === 'user' ? parsed.message.content : ''
    expect(content).toBeTypeOf('string')
    expect((content as string).startsWith('hello ')).toBe(true)
    expect((content as string).length).toBe(2000)
  })

  it('extracts capped tool inputs needed by optimize', () => {
    const parsed = parseJsonlLine(Buffer.from(largeAssistantLine()))
    const msg = parsed?.message
    expect(msg?.role).toBe('assistant')
    if (msg?.role !== 'assistant') return
    expect(msg.usage.input_tokens).toBe(100)
    expect(msg.usage.output_tokens).toBe(20)
    expect(msg.usage.cache_read_input_tokens).toBe(300)
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'read1', name: 'Read', input: { file_path: '/tmp/file.ts' } },
      { type: 'tool_use', id: 'agent1', name: 'Agent', input: { subagent_type: 'reviewer' } },
    ])
  })

  it('extracts deferred MCP inventory from large attachment lines', () => {
    const line = JSON.stringify({
      type: 'attachment',
      sessionId: 's1',
      timestamp: '2026-05-01T00:00:02Z',
      padding: 'x'.repeat(40_000),
      attachment: {
        type: 'deferred_tools_delta',
        addedNames: ['Bash', 'mcp__svc__tool'],
      },
    })
    const parsed = parseJsonlLine(Buffer.from(line)) as Record<string, unknown>
    expect(parsed['attachment']).toEqual({
      type: 'deferred_tools_delta',
      addedNames: ['Bash', 'mcp__svc__tool'],
    })
  })
})
