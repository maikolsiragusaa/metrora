// Regression for issue #852: parseProviderSources range-filtered a whole turn
// by `turn.calls[0]?.timestamp`. A turn that spans local midnight (common for
// long-running autonomous Codex sessions) had every call after the boundary
// dropped from the new day, so `codeburn today` showed no usage until the
// turn ended and daily history attributed the whole turn's cost to the
// turn-start day.
//
// The repro is timezone-sensitive in the original report (reporter used
// UTC+8, whose local midnight is 16:00 UTC). To keep this test deterministic
// regardless of the machine's local zone, the "day boundary" here is just a
// fixed UTC instant used directly as the dateRange split — no local-timezone
// resolution is involved.

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'

import { loadPricing } from '../src/models.js'
import { aggregateProjectsIntoDays } from '../src/day-aggregator.js'
import { getDateRange } from '../src/cli-date.js'

const testRoot = vi.hoisted(() => {
  const root = `${process.env['TMPDIR'] || '/tmp'}/codex-midnight-repro-${process.pid}-${Date.now()}`
  process.env['HOME'] = `${root}/home`
  process.env['USERPROFILE'] = `${root}/home`
  process.env['CODEX_HOME'] = `${root}/codex`
  return root
})

const CODEX_HOME = join(testRoot, 'codex')
const CACHE_DIR = join(testRoot, 'cache')

// A fixed "day boundary" instant, standing in for local midnight. Everything
// below the boundary is "day 1", everything at/after is "day 2" — expressed
// purely in UTC so the test never depends on the machine's TZ.
const BOUNDARY = new Date('2026-07-28T16:00:00.000Z')
const DAY1_RANGE = { start: new Date('2026-07-27T16:00:00.000Z'), end: new Date(BOUNDARY.getTime() - 1) }
const DAY2_RANGE = { start: BOUNDARY, end: new Date('2026-07-29T15:59:59.999Z') }
const OUT_OF_RANGE = { start: new Date('2026-08-01T00:00:00.000Z'), end: new Date('2026-08-02T00:00:00.000Z') }

beforeEach(async () => {
  process.env['HOME'] = join(testRoot, 'home')
  process.env['USERPROFILE'] = join(testRoot, 'home')
  process.env['CODEX_HOME'] = CODEX_HOME
  process.env['CODEBURN_CACHE_DIR'] = CACHE_DIR
  // Each test writes its own fixture(s) fresh — wipe any session files and
  // disk cache left by a previous test in this file so ranges don't pick up
  // unrelated fixtures.
  await rm(join(CODEX_HOME, 'sessions'), { recursive: true, force: true })
  await rm(CACHE_DIR, { recursive: true, force: true })
})

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

// Single turn (one user message, no second message) with two token_count
// calls straddling BOUNDARY — mirrors the issue's synthetic rollout.
async function writeMidnightTurn(): Promise<void> {
  const sessionDir = join(CODEX_HOME, 'sessions', '2026', '07', '28')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(CACHE_DIR, { recursive: true })
  const lines = [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-07-28T15:55:00.000Z', payload: { session_id: 'midnight-turn', originator: 'codex_cli_rs', cwd: '/tmp/t', model: 'gpt-5.5' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-07-28T15:57:00.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'work through midnight' }] } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-07-28T15:58:00.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100000, cached_input_tokens: 50000, cache_write_input_tokens: 0, output_tokens: 2000, reasoning_output_tokens: 0, total_tokens: 102000 }, last_token_usage: { input_tokens: 100000, cached_input_tokens: 50000, cache_write_input_tokens: 0, output_tokens: 2000, reasoning_output_tokens: 0, total_tokens: 102000 } } } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-07-28T16:10:00.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 200000, cached_input_tokens: 100000, cache_write_input_tokens: 0, output_tokens: 4000, reasoning_output_tokens: 0, total_tokens: 204000 }, last_token_usage: { input_tokens: 100000, cached_input_tokens: 50000, cache_write_input_tokens: 0, output_tokens: 2000, reasoning_output_tokens: 0, total_tokens: 102000 } } } }),
  ]
  await writeFile(join(sessionDir, 'rollout-midnight.jsonl'), lines.join('\n') + '\n')
}

// Same-day control: an identical two-call turn, both calls safely before
// BOUNDARY. Must behave exactly as before the fix (unchanged).
async function writeSameDayTurn(): Promise<void> {
  const sessionDir = join(CODEX_HOME, 'sessions', '2026', '07', '27')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(CACHE_DIR, { recursive: true })
  const lines = [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-07-27T20:00:00.000Z', payload: { session_id: 'sameday-turn', originator: 'codex_cli_rs', cwd: '/tmp/t', model: 'gpt-5.5' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-07-27T20:01:00.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'same day work' }] } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-07-27T20:02:00.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0, total_tokens: 10200 }, last_token_usage: { input_tokens: 10000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0, total_tokens: 10200 } } } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-07-27T20:05:00.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 20000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 400, reasoning_output_tokens: 0, total_tokens: 20400 }, last_token_usage: { input_tokens: 10000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0, total_tokens: 10200 } } } }),
  ]
  await writeFile(join(sessionDir, 'rollout-sameday.jsonl'), lines.join('\n') + '\n')
}

function callCount(projects: Awaited<ReturnType<typeof import('../src/parser.js').parseAllSessions>>): number {
  let n = 0
  for (const p of projects) for (const s of p.sessions) for (const t of s.turns) n += t.assistantCalls.length
  return n
}

describe('turn-range filter across a day boundary (issue #852)', () => {
  it('attributes post-midnight calls to the new day instead of dropping the turn', async () => {
    const { clearSessionCache, parseAllSessions } = await import('../src/parser.js')
    clearSessionCache()
    await loadPricing()
    await writeMidnightTurn()

    const day2Projects = await parseAllSessions(DAY2_RANGE, 'codex')
    expect(callCount(day2Projects)).toBe(1)
    const day2Sessions = day2Projects.flatMap(p => p.sessions)
    expect(day2Sessions).toHaveLength(1)
    // Only the post-boundary call's usage counts toward day 2.
    expect(day2Sessions[0]!.turns[0]!.assistantCalls[0]!.usage.inputTokens).toBe(50000)

    clearSessionCache()
    const day1Projects = await parseAllSessions(DAY1_RANGE, 'codex')
    expect(callCount(day1Projects)).toBe(1)
    const day1Sessions = day1Projects.flatMap(p => p.sessions)
    expect(day1Sessions).toHaveLength(1)
    expect(day1Sessions[0]!.turns[0]!.assistantCalls[0]!.usage.inputTokens).toBe(50000)
  })

  it('leaves a same-day turn unchanged', async () => {
    const { clearSessionCache, parseAllSessions } = await import('../src/parser.js')
    clearSessionCache()
    await loadPricing()
    await writeSameDayTurn()

    const projects = await parseAllSessions(DAY1_RANGE, 'codex')
    expect(callCount(projects)).toBe(2)
    const sessions = projects.flatMap(p => p.sessions)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.turns).toHaveLength(1)
    expect(sessions[0]!.turns[0]!.assistantCalls).toHaveLength(2)
  })

  it('still excludes a turn entirely outside the requested range', async () => {
    const { clearSessionCache, parseAllSessions } = await import('../src/parser.js')
    clearSessionCache()
    await loadPricing()
    await writeMidnightTurn()

    const projects = await parseAllSessions(OUT_OF_RANGE, 'codex')
    expect(callCount(projects)).toBe(0)
    expect(projects.flatMap(p => p.sessions)).toHaveLength(0)
  })

  it('does not double-count calls in the unfiltered (monthly/total) aggregate', async () => {
    const { clearSessionCache, parseAllSessions } = await import('../src/parser.js')
    clearSessionCache()
    await loadPricing()
    await writeMidnightTurn()
    await writeSameDayTurn()

    const totalProjects = await parseAllSessions(undefined, 'codex')
    // 2 calls from the midnight turn + 2 calls from the same-day turn = 4,
    // each counted exactly once — no split-then-duplicate across days.
    expect(callCount(totalProjects)).toBe(4)
  })

  // End-to-end version of the issue's actual complaint ("codeburn today shows
  // No usage data found"): `aggregateProjectsIntoDays` buckets a turn by its
  // `timestamp` field, not per-call timestamps (turn-anchored bucketing, see
  // day-aggregator.ts). A sliced turn must have `timestamp` re-anchored to its
  // surviving calls, or the retained post-midnight call still gets bucketed
  // under the pre-slice (prior-day) date and vanishes from `today`'s history
  // even though parseAllSessions now returns it.
  it('reconciles with the real UTC+8 "today" range used by getDateRange/day-aggregator', async () => {
    process.env['TZ'] = 'Asia/Shanghai'
    vi.useFakeTimers()
    // Local 2026-07-29 00:30 (UTC+8) == 2026-07-28T16:30:00Z — mid-turn, after
    // the second (post-midnight) call.
    vi.setSystemTime(new Date('2026-07-28T16:30:00.000Z'))
    try {
      const { clearSessionCache, parseAllSessions } = await import('../src/parser.js')
      clearSessionCache()
      await loadPricing()
      await writeMidnightTurn()

      const { range: todayRange } = getDateRange('today')
      const projects = await parseAllSessions(todayRange, 'codex')
      const days = aggregateProjectsIntoDays(projects)
      const today = days.find(d => d.date === '2026-07-29')
      expect(today).toBeDefined()
      expect(today!.calls).toBe(1)
    } finally {
      vi.useRealTimers()
      delete process.env['TZ']
    }
  })
})
