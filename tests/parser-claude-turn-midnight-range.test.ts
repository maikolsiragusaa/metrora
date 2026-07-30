// Regression for issue #852, Claude Code path: scanProjectDirs range-filtered
// a whole turn by `turn.assistantCalls[0].timestamp`, the same defect fixed
// in parseProviderSources for Codex/OTel providers. Claude Code is the
// highest-traffic provider, so a turn spanning local midnight had the same
// data-loss symptom: `codeburn today` showed nothing until the turn ended.
//
// Deterministic across machine timezones: the plain slicing tests use a
// fixed UTC boundary as the dateRange split (no local-timezone resolution);
// the day-aggregator reconciliation test explicitly sets TZ + fakes the
// clock to reproduce the issue's UTC+8 scenario.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { parseAllSessions, clearSessionCache } from '../src/parser.js'
import { loadPricing } from '../src/models.js'
import { aggregateByPr, prLinkedTotals } from '../src/sessions-report.js'
import { aggregateProjectsIntoDays } from '../src/day-aggregator.js'
import { getDateRange } from '../src/cli-date.js'

let tmpDir: string
let configDir: string

const BOUNDARY = new Date('2026-07-28T16:00:00.000Z')
const DAY1_RANGE = { start: new Date('2026-07-27T16:00:00.000Z'), end: new Date(BOUNDARY.getTime() - 1) }
const DAY2_RANGE = { start: BOUNDARY, end: new Date('2026-07-29T15:59:59.999Z') }
const OUT_OF_RANGE = { start: new Date('2026-08-01T00:00:00.000Z'), end: new Date('2026-08-02T00:00:00.000Z') }

beforeEach(async () => {
  clearSessionCache()
  tmpDir = await mkdtemp(join(tmpdir(), 'claude-midnight-'))
  configDir = join(tmpDir, 'claude')
  process.env['CLAUDE_CONFIG_DIR'] = configDir
  process.env['CODEBURN_CACHE_DIR'] = join(tmpDir, 'cache')
})

afterEach(async () => {
  clearSessionCache()
  delete process.env['CLAUDE_CONFIG_DIR']
  delete process.env['CODEBURN_CACHE_DIR']
  await rm(tmpDir, { recursive: true, force: true })
})

// One user message, two assistant calls straddling BOUNDARY — the Claude
// Code equivalent of the Codex synthetic repro (one turn, two calls).
async function writeMidnightTurn(): Promise<void> {
  const projDir = join(configDir, 'projects', 'midnight-proj')
  await mkdir(projDir, { recursive: true })
  const SID = '22222222-2222-4222-8222-222222222222'
  await writeFile(join(projDir, `${SID}.jsonl`),
    JSON.stringify({ type: 'user', sessionId: SID, timestamp: '2026-07-28T15:57:00.000Z', cwd: '/tmp/midnight-proj', message: { role: 'user', content: 'work through midnight' } }) + '\n' +
    JSON.stringify({ type: 'assistant', sessionId: SID, timestamp: '2026-07-28T15:58:00.000Z', cwd: '/tmp/midnight-proj', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], usage: { input_tokens: 1000, output_tokens: 200 } } }) + '\n' +
    JSON.stringify({ type: 'assistant', sessionId: SID, timestamp: '2026-07-28T16:10:00.000Z', cwd: '/tmp/midnight-proj', message: { id: 'm2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], usage: { input_tokens: 2000, output_tokens: 400 } } }) + '\n')
}

async function writeSameDayTurn(): Promise<void> {
  const projDir = join(configDir, 'projects', 'sameday-proj')
  await mkdir(projDir, { recursive: true })
  const SID = '33333333-3333-4333-8333-333333333333'
  await writeFile(join(projDir, `${SID}.jsonl`),
    JSON.stringify({ type: 'user', sessionId: SID, timestamp: '2026-07-27T20:01:00.000Z', cwd: '/tmp/sameday-proj', message: { role: 'user', content: 'same day work' } }) + '\n' +
    JSON.stringify({ type: 'assistant', sessionId: SID, timestamp: '2026-07-27T20:02:00.000Z', cwd: '/tmp/sameday-proj', message: { id: 's1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], usage: { input_tokens: 100, output_tokens: 20 } } }) + '\n' +
    JSON.stringify({ type: 'assistant', sessionId: SID, timestamp: '2026-07-27T20:05:00.000Z', cwd: '/tmp/sameday-proj', message: { id: 's2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], usage: { input_tokens: 200, output_tokens: 40 } } }) + '\n')
}

function callCount(projects: Awaited<ReturnType<typeof parseAllSessions>>): number {
  let n = 0
  for (const p of projects) for (const s of p.sessions) for (const t of s.turns) n += t.assistantCalls.length
  return n
}

describe('Claude Code turn-range filter across a day boundary (issue #852)', () => {
  it('attributes post-midnight calls to the new day instead of dropping the turn', async () => {
    await loadPricing()
    await writeMidnightTurn()

    const day2Projects = await parseAllSessions(DAY2_RANGE, 'claude')
    expect(callCount(day2Projects)).toBe(1)
    const day2Sessions = day2Projects.flatMap(p => p.sessions)
    expect(day2Sessions).toHaveLength(1)
    expect(day2Sessions[0]!.turns[0]!.assistantCalls[0]!.usage.inputTokens).toBe(2000)

    clearSessionCache()
    const day1Projects = await parseAllSessions(DAY1_RANGE, 'claude')
    expect(callCount(day1Projects)).toBe(1)
    const day1Sessions = day1Projects.flatMap(p => p.sessions)
    expect(day1Sessions).toHaveLength(1)
    expect(day1Sessions[0]!.turns[0]!.assistantCalls[0]!.usage.inputTokens).toBe(1000)
  })

  it('leaves a same-day turn unchanged', async () => {
    await loadPricing()
    await writeSameDayTurn()

    const projects = await parseAllSessions(DAY1_RANGE, 'claude')
    expect(callCount(projects)).toBe(2)
    const sessions = projects.flatMap(p => p.sessions)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.turns).toHaveLength(1)
    expect(sessions[0]!.turns[0]!.assistantCalls).toHaveLength(2)
  })

  it('still excludes a turn entirely outside the requested range', async () => {
    await loadPricing()
    await writeMidnightTurn()

    const projects = await parseAllSessions(OUT_OF_RANGE, 'claude')
    expect(callCount(projects)).toBe(0)
    expect(projects.flatMap(p => p.sessions)).toHaveLength(0)
  })

  it('does not double-count calls in the unfiltered (monthly/total) aggregate', async () => {
    await loadPricing()
    await writeMidnightTurn()
    await writeSameDayTurn()

    const totalProjects = await parseAllSessions(undefined, 'claude')
    expect(callCount(totalProjects)).toBe(4)
  })

  it('reconciles with the real UTC+8 "today" range used by getDateRange/day-aggregator', async () => {
    process.env['TZ'] = 'Asia/Shanghai'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T16:30:00.000Z')) // local 2026-07-29 00:30
    try {
      await loadPricing()
      await writeMidnightTurn()

      const { range: todayRange } = getDateRange('today')
      const projects = await parseAllSessions(todayRange, 'claude')
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

describe('subagent fold anchor is unaffected by turn slicing (issue #852)', () => {
  const CWD = '/tmp/anchor-proj'
  const PR = 'https://github.com/o/r/pull/1'
  const PARENT = '11111111-1111-4111-8111-111111111111'
  const AGENT = 'a1234567890abcdef'
  const SPAWN = 'toolu_spawn_anchor'

  async function writeAnchorTranscripts(): Promise<void> {
    const projDir = join(configDir, 'projects', 'anchor-proj')
    const subDir = join(projDir, PARENT, 'subagents')
    await mkdir(subDir, { recursive: true })

    // Parent's own turn is entirely BEFORE DAY2_RANGE (not straddling it) —
    // out of range in full, same as before this fix.
    await writeFile(join(projDir, `${PARENT}.jsonl`),
      JSON.stringify({ type: 'user', sessionId: PARENT, timestamp: '2026-07-27T23:00:00.000Z', cwd: CWD, message: { role: 'user', content: 'ship the PR and launch a reviewer' } }) + '\n' +
      JSON.stringify({ type: 'assistant', sessionId: PARENT, timestamp: '2026-07-27T23:00:01.000Z', cwd: CWD, message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: SPAWN, name: 'Agent', input: {} }], usage: { input_tokens: 10, output_tokens: 5 } } }) + '\n' +
      JSON.stringify({ type: 'pr-link', sessionId: PARENT, timestamp: '2026-07-27T23:00:02.000Z', cwd: CWD, prUrl: PR }) + '\n' +
      JSON.stringify({ type: 'user', sessionId: PARENT, timestamp: '2026-07-27T23:05:00.000Z', cwd: CWD, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: SPAWN, content: 'reviewer done' }] }, toolUseResult: { status: 'completed', agentId: AGENT, content: 'reviewer done' } }) + '\n')

    // Child's work is inside DAY2_RANGE (post-boundary).
    await writeFile(join(subDir, `agent-${AGENT}.jsonl`),
      JSON.stringify({ type: 'user', isSidechain: true, sessionId: PARENT, agentId: AGENT, timestamp: '2026-07-28T16:10:00.000Z', cwd: CWD, message: { role: 'user', content: 'review this' } }) + '\n' +
      JSON.stringify({ type: 'assistant', isSidechain: true, sessionId: PARENT, agentId: AGENT, timestamp: '2026-07-28T16:10:05.000Z', cwd: CWD, message: { id: 'c1', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 1000, output_tokens: 500 } } }) + '\n')
  }

  it('still folds an in-range child into its parent PR with zero parent spend when the parent turn is fully out of range', async () => {
    await loadPricing()
    await writeAnchorTranscripts()

    const projects = await parseAllSessions(DAY2_RANGE, 'claude')

    const childPresent = projects.some(p => p.sessions.some(s => s.sessionId === `agent-${AGENT}`))
    expect(childPresent).toBe(true)
    const anchorInSessions = projects.some(p => p.sessions.some(s => s.sessionId === PARENT))
    expect(anchorInSessions).toBe(false)
    const anchorHeldSeparately = projects.some(p => (p.subagentAnchors ?? []).some(s => s.sessionId === PARENT))
    expect(anchorHeldSeparately).toBe(true)

    const rows = aggregateByPr(projects)
    const row = rows.find(r => r.url === PR)
    expect(row).toBeDefined()
    expect(row!.cost).toBeGreaterThan(0)
    expect(row!.models).toContain('Opus 4.8')

    const totals = prLinkedTotals(projects)
    expect(totals.subagentSessions).toBe(1)
    expect(totals.attributedCost).toBeCloseTo(row!.cost, 6)
  })
})
