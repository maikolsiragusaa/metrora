import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

import { getDateRange } from '../src/cli-date.js'
import { readC3CliStatusBatchV1 } from '../src/local-state/canonical-history-cli-dual-read.js'

type Headline = {
  cost: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

type LifecycleTrace = {
  legacy: { today: Headline; month: Headline }
  c3: { today?: Headline; month?: Headline }
  generationId?: string
  publication: { today: { status: string; timingsMs: Record<string, number> }; month: { status: string; timingsMs: Record<string, number> } }
  dualRead: Array<{ id: string; code: string }>
  primary: string
  performance: { legacyRefreshMs: { today: number; month: number }; c3PublicationMs: { today: Record<string, number>; month: Record<string, number> }; headlineReadMs: number }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function runFreshStatus(home: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    METRORA_CACHE_DIR: join(home, '.cache', 'metrora'),
    METRORA_DATA_DIR: join(home, 'AppData', 'Local', 'Metrora'),
    HOME: home,
    USERPROFILE: home,
    HOMEPATH: home,
    HOMEDRIVE: '',
    CODEX_HOME: join(home, '.codex'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TZ: 'UTC',
    METRORA_VERBOSE: '1',
  }
  delete env.METRORA_READ_MODE
  return spawnSync(process.execPath, ['dist/cli.js', 'status', '--format', 'terminal', '--provider', 'codex'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 60_000,
  })
}

function traceFrom(result: ReturnType<typeof runFreshStatus>): LifecycleTrace {
  const line = result.stderr.split(/\r?\n/u).find(value => value.includes('"kind":"metrora-c3-analytics-lifecycle-v1"'))
  expect(line, result.stderr).toBeDefined()
  return JSON.parse(line!) as LifecycleTrace
}

async function immediateC3Hit(home: string, generationId: string) {
  const names = ['METRORA_CACHE_DIR', 'METRORA_DATA_DIR', 'CODEX_HOME', 'TZ'] as const
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  process.env.METRORA_CACHE_DIR = join(home, '.cache', 'metrora')
  process.env.METRORA_DATA_DIR = join(home, 'AppData', 'Local', 'Metrora')
  process.env.CODEX_HOME = join(home, '.codex')
  process.env.TZ = 'UTC'
  try {
    return await readC3CliStatusBatchV1([
      { id: 'today', range: getDateRange('today').range, provider: 'codex' },
      { id: 'month', range: getDateRange('month').range, provider: 'codex' },
    ], { expectedGenerationId: generationId })
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
}

function codexLine(type: string, timestamp: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, timestamp, payload })
}

function dateParts(value: Date): string[] {
  return value.toISOString().slice(0, 10).split('-')
}

describe('continuous Codex C3 analytics lifecycle', () => {
  it('publishes and immediately hits C3 for five evolving fresh generations', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-cli-c3-continuous-'))
    roots.push(home)
    const now = new Date()
    const todayParts = dateParts(now)
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const sessionDir = join(home, '.codex', 'sessions', ...todayParts)
    await mkdir(sessionDir, { recursive: true })
    for (let day = monthStart, index = 0; day < todayStart; day = new Date(day.getTime() + 24 * 60 * 60 * 1_000), index++) {
      const dayDir = join(home, '.codex', 'sessions', ...dateParts(day))
      await mkdir(dayDir, { recursive: true })
      const dayStamp = new Date(day.getTime() + 60_000).toISOString()
      await writeFile(join(dayDir, `rollout-c3-history-${index}.jsonl`), `${codexLine('session_meta', dayStamp, { cwd: '/repo/continuous-c3', originator: 'codex-cli', session_id: `continuous-c3-history-${index}`, model: 'gpt-5.3-codex' })}\n${codexLine('response_item', dayStamp, { type: 'message', role: 'user', content: [{ type: 'input_text', text: `history-${index}` }] })}\n${codexLine('event_msg', dayStamp, { type: 'token_count', info: { last_token_usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 }, total_token_usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 } } })}\n`, 'utf8')
    }
    const sourcePath = join(sessionDir, 'rollout-continuous-c3.jsonl')
    const sessionId = 'continuous-c3-session'
    const baseMs = Date.now() - 120_000
    const stamp = (offset: number) => new Date(baseMs + offset * 1_000).toISOString()
    const meta = codexLine('session_meta', stamp(0), { cwd: '/repo/continuous-c3', originator: 'codex-cli', session_id: sessionId, model: 'gpt-5.3-codex' })
    const user = codexLine('response_item', stamp(1), { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'initial' }] })
    const firstUsage = codexLine('event_msg', stamp(2), { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } })
    await writeFile(sourcePath, `${meta}\n${user}\n${firstUsage}\n`, 'utf8')

    const records: Array<{ generation: string; legacy: { today: Headline; month: Headline }; c3: { today?: Headline; month?: Headline }; publication: string; hit: string; legacyRefreshMs: { today: number; month: number }; publicationTimingsMs: { today: Record<string, number>; month: Record<string, number> }; headlineReadMs: number }> = []
    for (let generation = 1; generation <= 5; generation++) {
      const result = runFreshStatus(home)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('Today')
      expect(result.stdout).toContain('Month')
      const trace = traceFrom(result)
      expect(trace.generationId).toMatch(/^[a-f0-9]{64}$/u)
      expect(trace.publication.today.status).toBe('published')
      expect(trace.publication.month.status).toBe('published')
      expect(trace.dualRead).toEqual([{ id: 'today', code: 'C3_SUPPORTED_MATCH' }, { id: 'month', code: 'C3_SUPPORTED_MATCH' }])
      expect(trace.primary).toBe('C3_PRIMARY')
      expect(trace.c3.today).toEqual(trace.legacy.today)
      expect(trace.c3.month).toEqual(trace.legacy.month)
      const immediate = await immediateC3Hit(home, trace.generationId!)
      expect(immediate.map(item => item.code)).toEqual(['C3_SUPPORTED_MATCH', 'C3_SUPPORTED_MATCH'])
      records.push({
        generation: trace.generationId!,
        legacy: trace.legacy,
        c3: trace.c3,
        publication: `${trace.publication.today.status}/${trace.publication.month.status}`,
        hit: immediate.map(item => item.code).join('/'),
        legacyRefreshMs: trace.performance.legacyRefreshMs,
        publicationTimingsMs: trace.performance.c3PublicationMs,
        headlineReadMs: trace.performance.headlineReadMs,
      })
      if (generation < 5) {
        const total = 120 + generation * 30
        const appendedUser = codexLine('response_item', stamp(generation * 3 + 1), { type: 'message', role: 'user', content: [{ type: 'input_text', text: `append-${generation}` }] })
        const appendedUsage = codexLine('event_msg', stamp(generation * 3 + 2), { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, total_token_usage: { input_tokens: 100 + generation * 20, output_tokens: 20 + generation * 10, total_tokens: total } } })
        await appendFile(sourcePath, `${appendedUser}\n${appendedUsage}\n`, 'utf8')
        const afterSourceAdvanced = await immediateC3Hit(home, trace.generationId!)
        expect(afterSourceAdvanced.map(item => item.code)).toEqual(['C3_SUPPORTED_MATCH', 'C3_SUPPORTED_MATCH'])
      }
    }
    expect(new Set(records.map(record => record.generation)).size).toBe(5)
    console.log(JSON.stringify({ kind: 'c3-continuous-soak-evidence-v1', records }))
  }, 120_000)
})
