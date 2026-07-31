import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { parseAllSessions, clearSessionCache, parseJsonlLine } from '../src/parser.js'
import type { DateRange } from '../src/types.js'

// Every case here is padded past LARGE_JSONL_LINE_BYTES (32 KiB) so it exercises
// parseLargeJsonl's hand-rolled scanner rather than JSON.parse. These pin the
// exact extraction semantics that the single-pass rewrite must preserve.
const BIG = 'x'.repeat(40_000)

function expectParity(line: string): ReturnType<typeof parseJsonlLine> {
  const stringResult = parseJsonlLine(line)
  const bufferResult = parseJsonlLine(Buffer.from(line))
  expect(bufferResult).toEqual(stringResult)
  return stringResult
}

describe('single-pass large-line field extraction', () => {
  it('extracts every top-level field when the huge message blob precedes them', () => {
    // Realistic Claude shape: message (with a multi-KB content blob) comes first,
    // and type/timestamp/sessionId/cwd trail it. The old scanner re-walked the
    // blob once per trailing key; the result must be unchanged.
    const line = `{"parentUuid":"u1","message":{"model":"claude-sonnet-4-5","id":"m1","type":"message","role":"assistant","content":[{"type":"text","text":"${BIG}"},{"type":"tool_use","id":"tu","name":"Edit","input":{"file_path":"/tmp/x","old_string":"a"}}],"usage":{"input_tokens":1000,"output_tokens":100,"cache_read_input_tokens":5000}},"timestamp":"2026-05-01T00:00:00Z","type":"assistant","sessionId":"s-blob","cwd":"/repo"}`
    const result = expectParity(line)
    expect(result).toEqual({
      type: 'assistant',
      timestamp: '2026-05-01T00:00:00Z',
      sessionId: 's-blob',
      cwd: '/repo',
      message: {
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        id: 'm1',
        content: [{ type: 'tool_use', id: 'tu', name: 'Edit', input: { file_path: '/tmp/x' } }],
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 5000 },
      },
    })
  })

  it('takes the first occurrence of duplicate top-level keys', () => {
    // findObjectFieldValue returns the first matching key; a single pass must
    // capture first-wins for every field identically.
    const line = `{"type":"user","type":"assistant","timestamp":"2026-05-01T00:00:00Z","timestamp":"2027-01-01T00:00:00Z","sessionId":"first","sessionId":"second","message":{"role":"user","content":"hello-one"},"message":{"role":"user","content":"hello-two"},"padding":"${BIG}"}`
    const result = expectParity(line)
    expect(result).toEqual({
      type: 'user',
      timestamp: '2026-05-01T00:00:00Z',
      sessionId: 'first',
      message: { role: 'user', content: 'hello-one' },
    })
  })

  it('skips values containing escaped quotes, backslashes and delimiters before the target keys', () => {
    // The leading "note" value hides braces/brackets/quotes behind escapes; the
    // scanner must treat them as string bytes and not desync key detection.
    const note = 'he said \\"hi\\" then \\\\ {\\"brace\\":[1,2]} }] end'
    const line = `{"note":"${note}${BIG}","type":"user","sessionId":"esc","timestamp":"2026-05-01T00:00:00Z","message":{"role":"user","content":"payload"}}`
    const result = expectParity(line)
    expect(result).toEqual({
      type: 'user',
      sessionId: 'esc',
      timestamp: '2026-05-01T00:00:00Z',
      message: { role: 'user', content: 'payload' },
    })
  })

  it('skips nested objects and arrays inside earlier values', () => {
    const line = `{"skip":{"a":[1,{"b":2},"}]"],"c":{"d":["${BIG}"]}},"type":"user","sessionId":"nest","timestamp":"2026-05-01T00:00:00Z","message":{"role":"user","content":"deep"}}`
    const result = expectParity(line)
    expect(result).toEqual({
      type: 'user',
      sessionId: 'nest',
      timestamp: '2026-05-01T00:00:00Z',
      message: { role: 'user', content: 'deep' },
    })
  })

  it('preserves unicode escapes inside a skipped value ahead of the keys', () => {
    const line = `{"lead":"snow \\u2603 star \\u2b50 ${BIG}","type":"user","sessionId":"uni","timestamp":"2026-05-01T00:00:00Z","message":{"role":"user","content":"u"}}`
    const result = expectParity(line)
    expect(result).toEqual({
      type: 'user',
      sessionId: 'uni',
      timestamp: '2026-05-01T00:00:00Z',
      message: { role: 'user', content: 'u' },
    })
  })

  it('returns null for a torn line that never closes the root object', () => {
    const full = `{"type":"user","sessionId":"torn","timestamp":"2026-05-01T00:00:00Z","message":{"role":"user","content":"${BIG}"}}`
    const torn = full.slice(0, -3)
    expect(parseJsonlLine(torn)).toBeNull()
    expect(parseJsonlLine(Buffer.from(torn))).toBeNull()
  })

  it('returns null when an unterminated array swallows the target keys', () => {
    // The root '}' closes before the '[' does, so "type" lives inside an
    // unparseable value and is never seen as a top-level key.
    const line = `{"a":[1,2,"${BIG}","type":"user","sessionId":"x","timestamp":"2026-05-01T00:00:00Z"}`
    expect(parseJsonlLine(line)).toBeNull()
    expect(parseJsonlLine(Buffer.from(line))).toBeNull()
  })

  it('returns null for non-JSON garbage on the large path', () => {
    const garbage = `not json at all ${BIG} still not json`
    expect(parseJsonlLine(garbage)).toBeNull()
    expect(parseJsonlLine(Buffer.from(garbage))).toBeNull()
  })

  it('returns null for a top-level JSON array on the large path', () => {
    const line = `[{"type":"user","sessionId":"arr","timestamp":"2026-05-01T00:00:00Z","padding":"${BIG}"}]`
    expect(parseJsonlLine(line)).toBeNull()
    expect(parseJsonlLine(Buffer.from(line))).toBeNull()
  })

  it('drops an entry whose type field is missing', () => {
    const line = `{"sessionId":"notype","timestamp":"2026-05-01T00:00:00Z","message":{"role":"user","content":"c"},"padding":"${BIG}"}`
    expect(parseJsonlLine(line)).toBeNull()
    expect(parseJsonlLine(Buffer.from(line))).toBeNull()
  })

  it('keeps a non-user/assistant type with its metadata but no message', () => {
    const line = `{"type":"summary","sessionId":"sum","timestamp":"2026-05-01T00:00:00Z","cwd":"/repo","message":{"role":"user","content":"ignored"},"padding":"${BIG}"}`
    const result = expectParity(line)
    expect(result).toEqual({
      type: 'summary',
      sessionId: 'sum',
      timestamp: '2026-05-01T00:00:00Z',
      cwd: '/repo',
    })
  })
})

describe('single-pass extraction whole-pipeline invariant', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'codeburn-singlepass-'))
    process.env['CLAUDE_CONFIG_DIR'] = join(home, '.claude')
  })

  afterEach(async () => {
    clearSessionCache()
    await rm(home, { recursive: true, force: true })
  })

  it('aggregates a session of message-first large lines to stable totals', async () => {
    const projectDir = join(home, '.claude', 'projects', 'singlepass')
    await mkdir(projectDir, { recursive: true })

    const hugeText = 'y'.repeat(60_000)
    const lines: string[] = []
    for (let i = 0; i < 20; i++) {
      const ts = `2026-04-10T10:${String(i).padStart(2, '0')}:00Z`
      lines.push(`{"type":"user","sessionId":"s1","timestamp":"${ts}","cwd":"/projects/app","message":{"role":"user","content":"${'u'.repeat(5000)}"}}`)
      lines.push(`{"parentUuid":"p${i}","message":{"model":"claude-sonnet-4-5","id":"m${i}","type":"message","role":"assistant","content":[{"type":"text","text":"${hugeText}"},{"type":"tool_use","id":"e${i}","name":"Edit","input":{"file_path":"/tmp/x","old_string":"a","new_string":"b"}},{"type":"tool_use","id":"r${i}","name":"Read","input":{"file_path":"/tmp/y"}}],"usage":{"input_tokens":1000,"output_tokens":100,"cache_read_input_tokens":5000}},"timestamp":"${ts.replace(':00Z', ':30Z')}","type":"assistant","sessionId":"s1","cwd":"/projects/app"}`)
    }

    await writeFile(join(projectDir, 'session.jsonl'), lines.join('\n'))

    const range: DateRange = {
      start: new Date('2026-04-10T00:00:00Z'),
      end: new Date('2026-04-10T23:59:59Z'),
    }

    const projects = await parseAllSessions(range, 'claude')
    expect(projects.length).toBe(1)
    const sess = projects[0]!.sessions[0]!
    expect(sess.apiCalls).toBe(20)
    expect(sess.totalInputTokens).toBe(20 * 1000)
    expect(sess.totalOutputTokens).toBe(20 * 100)
    expect(sess.totalCacheReadTokens).toBe(20 * 5000)
    expect(sess.toolBreakdown['Edit']?.calls).toBe(20)
    expect(sess.toolBreakdown['Read']?.calls).toBe(20)
    for (const turn of sess.turns) {
      expect(turn.userMessage.length).toBeLessThanOrEqual(2000)
      expect(turn.assistantCalls[0]!.model).toBe('claude-sonnet-4-5')
    }
  })
})
