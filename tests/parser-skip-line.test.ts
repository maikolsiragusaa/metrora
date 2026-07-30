import { describe, it, expect } from 'vitest'

import { shouldSkipLine } from '../src/parser.js'

const threshold = '2026-04-01T00:00:00.000Z'

function makeLine(type: string, timestamp: string, payloadSize = 0): string {
  const payload = payloadSize > 0 ? `,"content":"${'x'.repeat(payloadSize)}"` : ''
  return `{"type":"${type}","sessionId":"s1","timestamp":"${timestamp}"${payload}}`
}

function makeLineWithLongCwd(type: string, timestamp: string, cwdLength: number): string {
  const cwd = '/projects/' + 'a'.repeat(cwdLength)
  return `{"type":"${type}","sessionId":"s1","cwd":"${cwd}","timestamp":"${timestamp}","message":{"role":"user","content":"hi"}}`
}

describe('shouldSkipLine', () => {
  it('skips old user lines', () => {
    expect(shouldSkipLine(makeLine('user', '2026-03-01T10:00:00Z'), threshold)).toBe(true)
  })

  it('skips old assistant lines', () => {
    expect(shouldSkipLine(makeLine('assistant', '2026-03-15T10:00:00Z'), threshold)).toBe(true)
  })

  it('does not skip in-range user lines', () => {
    expect(shouldSkipLine(makeLine('user', '2026-04-05T10:00:00Z'), threshold)).toBe(false)
  })

  it('does not skip in-range assistant lines', () => {
    expect(shouldSkipLine(makeLine('assistant', '2026-04-10T10:00:00Z'), threshold)).toBe(false)
  })

  it('never skips attachment lines regardless of timestamp', () => {
    expect(shouldSkipLine(makeLine('attachment', '2026-01-01T00:00:00Z'), threshold)).toBe(false)
  })

  it('never skips system lines regardless of timestamp', () => {
    expect(shouldSkipLine(makeLine('system', '2026-01-01T00:00:00Z'), threshold)).toBe(false)
  })

  it('never skips summary lines regardless of timestamp', () => {
    expect(shouldSkipLine(makeLine('summary', '2026-01-01T00:00:00Z'), threshold)).toBe(false)
  })

  it('does not skip lines with no timestamp field', () => {
    expect(shouldSkipLine('{"type":"user","sessionId":"s1"}', threshold)).toBe(false)
  })

  it('does not skip lines with unparseable timestamp', () => {
    expect(shouldSkipLine('{"type":"user","timestamp":"bad"}', threshold)).toBe(false)
  })

  it('does not skip malformed JSON', () => {
    expect(shouldSkipLine('not json at all', threshold)).toBe(false)
  })

  it('only reads top-level type and timestamp fields', () => {
    const line = '{"message":{"type":"assistant","timestamp":"2026-03-01T10:00:00Z"},"type":"user","timestamp":"2026-04-05T10:00:00Z"}'
    expect(shouldSkipLine(line, threshold)).toBe(false)
  })

  it('handles timestamp pushed past 200 chars by long cwd', () => {
    const line = makeLineWithLongCwd('user', '2026-03-01T10:00:00Z', 300)
    expect(line.indexOf('"timestamp"')).toBeGreaterThan(200)
    expect(shouldSkipLine(line, threshold)).toBe(true)
  })

  it('handles timestamp at the edge of the 2048 head window', () => {
    const line = makeLineWithLongCwd('user', '2026-03-01T10:00:00Z', 1900)
    expect(line.indexOf('"timestamp"')).toBeGreaterThan(1900)
    expect(shouldSkipLine(line, threshold)).toBe(true)
  })

  it('returns false when timestamp is beyond the head window', () => {
    const line = makeLineWithLongCwd('user', '2026-03-01T10:00:00Z', 2100)
    expect(line.indexOf('"timestamp"')).toBeGreaterThan(2048)
    expect(shouldSkipLine(line, threshold)).toBe(false)
  })

  it('skips old assistant line with large payload without parsing it', () => {
    const line = makeLine('assistant', '2026-02-01T10:00:00Z', 50_000_000)
    expect(line.length).toBeGreaterThan(50_000_000)
    expect(shouldSkipLine(line, threshold)).toBe(true)
  })
})
