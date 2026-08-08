import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 })

const { ORIGINAL_ENV } = vi.hoisted(() => {
  const envKeys = [
    'HOME', 'USERPROFILE', 'HOMEPATH', 'HOMEDRIVE', 'APPDATA', 'LOCALAPPDATA',
    'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'METRORA_CACHE_DIR',
    'METRORA_CONFIG_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIRS', 'CODEX_HOME',
    'OPENCODE_DATA_DIR', 'CLINE_DIR', 'CLINE_DATA_DIR', 'CLINE_SESSION_DATA_DIR',
    'CODEWHALE_HOME', 'CODEBUFF_DATA_DIR', 'METRORA_DESKTOP_SESSIONS_DIR',
    'METRORA_COPILOT_SESSION_STATE_DIR', 'METRORA_COPILOT_OTEL_DB',
    'METRORA_COPILOT_JETBRAINS_DIR', 'METRORA_COPILOT_WS_STORAGE_DIR',
    'METRORA_COPILOT_GLOBAL_STORAGE_DIR', 'FACTORY_DIR', 'HERMES_HOME',
    'KIMI_SHARE_DIR', 'KIMI_CODE_HOME', 'KIRO_HOME', 'VIBE_HOME',
    'LINGTAI_TUI_GLOBAL_DIR', 'LINGTAI_HOME', 'LINGTAI_TUI_HOME', 'METRORA_MUX_DIR',
    'QWEN_DATA_DIR', 'QUICKWORK_HOME', 'ZS_DATA_DIR', 'GROK_HOME',
  ] as const
  const original = Object.fromEntries(envKeys.map(key => [key, process.env[key]])) as Record<string, string | undefined>
  const separator = process.platform === 'win32' ? '\\' : '/'
  const base = process.env['TMPDIR'] ?? process.env['TMP'] ?? process.env['TEMP'] ?? '.'
  const root = `${base}${base.endsWith(separator) ? '' : separator}metrora-hydration-isolated-home`
  const home = `${root}${separator}home`
  const isolated: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    HOMEPATH: home,
    HOMEDRIVE: '',
    APPDATA: `${home}${separator}AppData${separator}Roaming`,
    LOCALAPPDATA: `${home}${separator}AppData${separator}Local`,
    XDG_DATA_HOME: `${home}${separator}.local${separator}share`,
    XDG_CONFIG_HOME: `${home}${separator}.config`,
    XDG_CACHE_HOME: `${home}${separator}.cache`,
    METRORA_CACHE_DIR: `${root}${separator}cache`,
    METRORA_CONFIG_DIR: `${home}${separator}.config${separator}metrora`,
    CODEX_HOME: `${home}${separator}.codex`,
    OPENCODE_DATA_DIR: `${home}${separator}.local${separator}share${separator}opencode`,
  }
  for (const [key, value] of Object.entries(isolated)) process.env[key] = value
  for (const key of envKeys) {
    if (!(key in isolated)) delete process.env[key]
  }
  return { ORIGINAL_ENV: original }
})

import { loadPricing, setLocalModelSavings, setModelAliases } from '../src/models.js'
import { buildMenubarPayloadForRange } from '../src/usage-aggregator.js'
import { clearSessionCache } from '../src/parser.js'
import { sessionCachePath } from '../src/session-cache.js'
import { dailyCachePath } from '../src/daily-cache.js'
import type { DateRange } from '../src/types.js'

// Several DISTINCT historical days (all strictly before yesterday, so each lands
// in the daily backfill window). The chart-freeze bug drops exactly these older
// days, so the fixture must span more than one.
const now = new Date()
function daysAgo(n: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
}
function isoAt(d: Date, hour: number): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0).toISOString()
}
const FIXTURE_DAYS = [12, 9, 6, 4].map(daysAgo)
const RANGE: DateRange = { start: daysAgo(30), end: now }
const PERIOD = { range: RANGE, label: '30-day window' }

let tmpDirs: string[] = []

beforeAll(async () => {
  await loadPricing()
})
beforeEach(() => {
  setLocalModelSavings({})
  setModelAliases({})
})
afterEach(async () => {
  clearSessionCache()
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop()
    if (d) await rm(d, { recursive: true, force: true })
  }
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

/** Point discovery + cache at fresh isolated dirs and seed the fixture sessions. */
async function seed(): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'metrora-hyd-src-'))
  const cacheDir = await mkdtemp(join(tmpdir(), 'metrora-hyd-cache-'))
  tmpDirs.push(base, cacheDir)
  const projectDir = join(base, 'projects', 'p')
  await mkdir(projectDir, { recursive: true })

  const line = (id: string, ts: string): string => JSON.stringify({
    type: 'assistant', timestamp: ts, sessionId: `s-${id}`,
    message: {
      type: 'message', role: 'assistant', model: 'claude-3-5-sonnet-20241022', id,
      content: [],
      usage: { input_tokens: 80000, output_tokens: 16000, cache_creation_input_tokens: 0, cache_read_input_tokens: 300000 },
    },
  })
  // One session file per fixture day.
  for (let i = 0; i < FIXTURE_DAYS.length; i++) {
    await writeFile(join(projectDir, `s${i}.jsonl`), line(`msg-${i}`, isoAt(FIXTURE_DAYS[i]!, 10)) + '\n', 'utf-8')
  }

  process.env['CLAUDE_CONFIG_DIR'] = base
  process.env['METRORA_CACHE_DIR'] = cacheDir
}

/** The (date, cost) shape of the daily chart — the thing that froze empty. */
function dailyShape(payload: Awaited<ReturnType<typeof buildMenubarPayloadForRange>>): Array<[string, number]> {
  return payload.history.daily.map(d => [d.date, Math.round(d.cost * 1e6) / 1e6] as [string, number])
}

describe('interrupted hydration converges to the uninterrupted result', () => {
  it('re-hydrates a session cache + daily history frozen from a partial scan and matches a never-interrupted run', async () => {
    // ── Reference: a clean, never-interrupted hydration. ──
    await seed()
    clearSessionCache()
    const reference = await buildMenubarPayloadForRange(PERIOD, { provider: 'all', optimize: false, timeline: false })
    const refDaily = dailyShape(reference)
    // Sanity: the fixture really produced a multi-day, non-zero chart.
    expect(reference.current.cost).toBeGreaterThan(0)
    expect(refDaily.length).toBeGreaterThanOrEqual(FIXTURE_DAYS.length)

    // ── Simulate an interrupted / raced hydration by poisoning the on-disk caches
    //    to exactly the artifact such a run leaves behind. ──
    await seed()
    clearSessionCache()
    // Prime real caches, then corrupt them into the "partial" state.
    await buildMenubarPayloadForRange(PERIOD, { provider: 'all', optimize: false, timeline: false })

    // (a) Session cache: present but NOT marked complete — an interrupted cold
    //     start's throttled partial save.
    const sessionRaw = JSON.parse(await readFile(sessionCachePath(), 'utf-8'))
    sessionRaw.complete = false
    await writeFile(sessionCachePath(), JSON.stringify(sessionRaw), 'utf-8')

    // (b) Daily cache: frozen with the older days dropped but `lastComputedDate`
    //     advanced to yesterday and NO completeness marker — the exact freeze that
    //     leaves the chart empty for the first ~N days forever.
    const yesterday = daysAgo(1)
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    const dailyRaw = JSON.parse(await readFile(dailyCachePath(), 'utf-8'))
    dailyRaw.days = []
    dailyRaw.lastComputedDate = yesterdayStr
    delete dailyRaw.complete
    await writeFile(dailyCachePath(), JSON.stringify(dailyRaw), 'utf-8')

    // ── Relaunch: the parse must detect both caches as incomplete, finish the
    //    backfill, and converge to the reference. ──
    clearSessionCache()
    const healed = await buildMenubarPayloadForRange(PERIOD, { provider: 'all', optimize: false, timeline: false })

    // The frozen chart is fully restored, day-for-day and cost-for-cost.
    expect(dailyShape(healed)).toEqual(refDaily)
    // Headline totals converge exactly.
    expect(healed.current.cost).toBe(reference.current.cost)
    expect(healed.current.calls).toBe(reference.current.calls)

    // And the on-disk markers are now durably complete, so the next launch is warm.
    expect(JSON.parse(await readFile(sessionCachePath(), 'utf-8')).complete).toBe(true)
    expect(JSON.parse(await readFile(dailyCachePath(), 'utf-8')).complete).toBe(true)
  })
})
