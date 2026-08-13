import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

import { loadDailyCache } from '../src/daily-cache.js'
import { canonicalHistoryShadowPathsV1 } from '../src/local-state/canonical-history-shadow-store.js'
import { publishCanonicalHistoryAnalyticsV1 } from '../src/local-state/canonical-history-analytics-publication.js'
import { loadOrCreateLocalEndpointIdentityV1 } from '../src/local-state/endpoint-identity.js'
import { Aes256GcmSecretProtector } from '../src/local-state/secret-protector.js'
import { loadCache } from '../src/session-cache.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function dataDirFor(home: string): string {
  return join(home, 'metrora-data')
}

async function seedEndpointIdentity(dataDir: string): Promise<void> {
  await loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 19)),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
  })
}

async function publishFromChildCaches(home: string, dataDir: string) {
  const names = ['METRORA_CACHE_DIR', 'METRORA_DATA_DIR', 'TZ'] as const
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  process.env.METRORA_CACHE_DIR = join(home, '.cache', 'metrora')
  process.env.METRORA_DATA_DIR = dataDir
  process.env.TZ = 'UTC'
  try {
    return await publishCanonicalHistoryAnalyticsV1({
      sessionCache: await loadCache(),
      dailyCache: await loadDailyCache(),
      dataDir,
    })
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
}

function runCli(args: string[], home: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      METRORA_CACHE_DIR: join(home, '.cache', 'metrora'),
      METRORA_DATA_DIR: dataDirFor(home),
      HOME: home,
      USERPROFILE: home,
      HOMEPATH: home,
      HOMEDRIVE: '',
      CODEX_HOME: join(home, '.codex'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      TZ: 'UTC',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 60_000,
  })
}

async function readC3Artifacts(dataDir: string): Promise<{
  head: string | undefined
  publicationState: string | undefined
  snapshots: Record<string, string>
  headlineIndexes: Record<string, string>
}> {
  const paths = canonicalHistoryShadowPathsV1(dataDir)
  const readDirectory = async (directory: string): Promise<Record<string, string>> => {
    const names = (await readdir(directory).catch(() => [])).sort()
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(directory, name), 'utf8')])))
  }
  return {
    head: await readFile(paths.head, 'utf8').catch(() => undefined),
    publicationState: await readFile(join(paths.root, 'publication-state.v1.json'), 'utf8').catch(() => undefined),
    snapshots: await readDirectory(paths.snapshots),
    headlineIndexes: await readDirectory(paths.headlineIndexes),
  }
}

describe('CLI status C3 analytics lifecycle', () => {
  it('keeps canonical C3 publication out of fresh terminal status', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-cli-c3-lifecycle-'))
    roots.push(home)
    const dataDir = dataDirFor(home)
    const projectDir = join(home, '.claude', 'projects', 'demo')
    await mkdir(projectDir, { recursive: true })
    const timestamp = new Date(Date.now() - 30_000).toISOString()
    const sessionId = 'c3-lifecycle-session'
    const lines = [
      JSON.stringify({ type: 'user', sessionId, timestamp, message: { role: 'user', content: 'hello' } }),
      JSON.stringify({
        type: 'assistant',
        sessionId,
        timestamp,
        message: {
          id: 'c3-message',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'hello' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }),
    ].join('\n') + '\n'
    await writeFile(join(projectDir, `${sessionId}.jsonl`), lines, 'utf8')

    const result = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, { METRORA_DATA_DIR: dataDir })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Today')
    expect(result.stdout).toContain('Month')

    const paths = canonicalHistoryShadowPathsV1(dataDir)
    expect(await readFile(paths.head, 'utf8').catch(() => undefined)).toBeUndefined()
    expect(await readdir(paths.headlineIndexes).catch(() => [])).toEqual([])
  }, 120_000)

  it('does not publish or silently refresh C3 in snapshot mode', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-cli-c3-snapshot-'))
    roots.push(home)
    const dataDir = dataDirFor(home)
    await seedEndpointIdentity(dataDir)
    const projectDir = join(home, '.claude', 'projects', 'demo')
    await mkdir(projectDir, { recursive: true })
    const timestamp = new Date(Date.now() - 30_000).toISOString()
    const sessionId = 'c3-snapshot-session'
    await writeFile(join(projectDir, `${sessionId}.jsonl`), [
      JSON.stringify({ type: 'user', sessionId, timestamp, message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant', sessionId, timestamp, message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 100, output_tokens: 20 } } }),
    ].join('\n') + '\n', 'utf8')

    const fresh = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, { METRORA_DATA_DIR: dataDir })
    expect(fresh.status).toBe(0)
    const paths = canonicalHistoryShadowPathsV1(dataDir)
    const publication = await publishFromChildCaches(home, dataDir)
    expect(publication.status).toBe('published')
    const before = await readFile(paths.head, 'utf8')
    const indexNamesBefore = (await readdir(paths.headlineIndexes)).sort()
    const indexesBefore = await Promise.all(indexNamesBefore.map(name => readFile(join(paths.headlineIndexes, name), 'utf8')))
    const snapshot = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, {
      METRORA_DATA_DIR: dataDir,
      METRORA_READ_MODE: 'snapshot',
    })
    expect(snapshot.status).toBe(0)
    expect(snapshot.stdout).toContain('Today')
    expect(await readFile(paths.head, 'utf8')).toBe(before)
    const indexNamesAfter = (await readdir(paths.headlineIndexes)).sort()
    expect(indexNamesAfter).toEqual(indexNamesBefore)
    expect(await Promise.all(indexNamesAfter.map(name => readFile(join(paths.headlineIndexes, name), 'utf8')))).toEqual(indexesBefore)
  }, 120_000)

  it('renders a separately published C3 headline only after exact legacy parity', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-cli-c3-parity-'))
    roots.push(home)
    const dataDir = dataDirFor(home)
    await seedEndpointIdentity(dataDir)
    const projectDir = join(home, '.claude', 'projects', 'demo')
    await mkdir(projectDir, { recursive: true })
    const timestamp = new Date(Date.now() - 30_000).toISOString()
    const sessionId = 'c3-parity-session'
    await writeFile(join(projectDir, `${sessionId}.jsonl`), [
      JSON.stringify({ type: 'user', sessionId, timestamp, message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant', sessionId, timestamp, message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 100, output_tokens: 20 } } }),
    ].join('\n') + '\n', 'utf8')
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    for (let day = monthStart, index = 0; day < todayStart; day = new Date(day.getTime() + 24 * 60 * 60 * 1_000), index++) {
      const dayStamp = new Date(day.getTime() + 12 * 60 * 60 * 1_000).toISOString()
      const historicalId = `c3-parity-history-${index}`
      await writeFile(join(projectDir, `${historicalId}.jsonl`), [
        JSON.stringify({ type: 'user', sessionId: historicalId, timestamp: dayStamp, message: { role: 'user', content: `history-${index}` } }),
        JSON.stringify({ type: 'assistant', sessionId: historicalId, timestamp: dayStamp, message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'history' }], usage: { input_tokens: 100, output_tokens: 20 } } }),
      ].join('\n') + '\n', 'utf8')
    }

    const initial = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, { METRORA_DATA_DIR: dataDir })
    expect(initial.status).toBe(0)
    const publication = await publishFromChildCaches(home, dataDir)
    expect(publication.status).toBe('published')

    const consumed = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, {
      METRORA_DATA_DIR: dataDir,
      METRORA_VERBOSE: '1',
    })
    expect(consumed.status).toBe(0)
    const traceLine = consumed.stderr.split(/\r?\n/u).find(value => value.includes('"kind":"metrora-c3-analytics-lifecycle-v1"'))
    expect(traceLine).toBeDefined()
    const trace = JSON.parse(traceLine!) as {
      legacy: { today: { calls: number }; month: { calls: number } }
      c3: { today?: { calls: number }; month?: { calls: number } }
      dualRead: Array<{ id: string; code: string }>
      primary: string
    }
    expect(trace.dualRead).toEqual([
      { id: 'today', code: 'C3_SUPPORTED_MATCH' },
      { id: 'month', code: 'C3_SUPPORTED_MATCH' },
    ])
    expect(trace.primary).toBe('PARITY_GATED_C3_RENDER')

    // Keep the event strictly later than the original while retaining the
    // fixture's already-past, current-period timestamp. The child CLI can no
    // longer change whether this event is eligible by crossing a wall-clock
    // boundary between append and launch.
    const advancedTimestamp = new Date(Date.parse(timestamp) + 1_000).toISOString()
    await appendFile(join(projectDir, `${sessionId}.jsonl`), JSON.stringify({
      type: 'assistant',
      sessionId,
      timestamp: advancedTimestamp,
      message: {
        id: 'c3-late-message',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'late' }],
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    }) + '\n', 'utf8')
    const c3BeforeMismatch = await readC3Artifacts(dataDir)
    const mismatch = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, {
      METRORA_DATA_DIR: dataDir,
      METRORA_VERBOSE: '1',
    })
    expect(mismatch.status).toBe(0)
    const mismatchLine = mismatch.stderr.split(/\r?\n/u).find(value => value.includes('"kind":"metrora-c3-analytics-lifecycle-v1"'))
    expect(mismatchLine).toBeDefined()
    const mismatchTrace = JSON.parse(mismatchLine!) as {
      legacy: { today: { calls: number }; month: { calls: number } }
      c3: { today?: { calls: number }; month?: { calls: number } }
      dualRead: Array<{ id: string; code: string }>
      primary: string
    }
    expect(mismatchTrace.dualRead).toEqual([
      { id: 'today', code: 'C3_SUPPORTED_MISMATCH' },
      { id: 'month', code: 'C3_SUPPORTED_MISMATCH' },
    ])
    expect(mismatchTrace.primary).toBe('LEGACY_FALLBACK')
    expect(mismatchTrace.legacy.today.calls).toBe(trace.legacy.today.calls + 1)
    expect(mismatchTrace.legacy.month.calls).toBe(trace.legacy.month.calls + 1)
    expect(mismatchTrace.c3).toEqual(trace.c3)
    expect(await readC3Artifacts(dataDir)).toEqual(c3BeforeMismatch)

    const republished = await publishFromChildCaches(home, dataDir)
    expect(republished.status).toBe('published')
    const recovered = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, {
      METRORA_DATA_DIR: dataDir,
      METRORA_VERBOSE: '1',
    })
    expect(recovered.status).toBe(0)
    const recoveredLine = recovered.stderr.split(/\r?\n/u).find(value => value.includes('"kind":"metrora-c3-analytics-lifecycle-v1"'))
    expect(recoveredLine).toBeDefined()
    const recoveredTrace = JSON.parse(recoveredLine!) as {
      dualRead: Array<{ id: string; code: string }>
      primary: string
    }
    expect(recoveredTrace.dualRead).toEqual([
      { id: 'today', code: 'C3_SUPPORTED_MATCH' },
      { id: 'month', code: 'C3_SUPPORTED_MATCH' },
    ])
    expect(recoveredTrace.primary).toBe('PARITY_GATED_C3_RENDER')
  }, 120_000)
})
