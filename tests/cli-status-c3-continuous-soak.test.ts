import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

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
  dualRead: Array<{ id: string; code: string }>
  primary: string
  performance: { headlineReadMs: number }
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
    METRORA_DATA_DIR: join(home, 'metrora-data'),
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

function codexLine(type: string, timestamp: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, timestamp, payload })
}

function dateParts(value: Date): string[] {
  return value.toISOString().slice(0, 10).split('-')
}

describe('continuous Codex CLI status lifecycle', () => {
  it('keeps C3 publication out of five evolving fresh generations', async () => {
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

    const records: Array<{ legacy: { today: Headline; month: Headline }; primary: string; headlineReadMs: number }> = []
    for (let generation = 1; generation <= 5; generation++) {
      const result = runFreshStatus(home)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('Today')
      expect(result.stdout).toContain('Month')
      const trace = traceFrom(result)
      expect(trace.dualRead).toEqual([
        { id: 'today', code: 'C3_UNAVAILABLE', reason: 'missing-shadow' },
        { id: 'month', code: 'C3_UNAVAILABLE', reason: 'missing-shadow' },
      ])
      expect(trace.primary).toBe('LEGACY_FALLBACK')
      expect(trace.c3).toEqual({})
      records.push({
        legacy: trace.legacy,
        primary: trace.primary,
        headlineReadMs: trace.performance.headlineReadMs,
      })
      if (generation < 5) {
        const total = 120 + generation * 30
        const appendedUser = codexLine('response_item', stamp(generation * 3 + 1), { type: 'message', role: 'user', content: [{ type: 'input_text', text: `append-${generation}` }] })
        const appendedUsage = codexLine('event_msg', stamp(generation * 3 + 2), { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, total_token_usage: { input_tokens: 100 + generation * 20, output_tokens: 20 + generation * 10, total_tokens: total } } })
        await appendFile(sourcePath, `${appendedUser}\n${appendedUsage}\n`, 'utf8')
      }
    }
    expect(records).toHaveLength(5)
    console.log(JSON.stringify({ kind: 'c3-terminal-no-publication-evidence-v1', records }))
  }, 120_000)
})
