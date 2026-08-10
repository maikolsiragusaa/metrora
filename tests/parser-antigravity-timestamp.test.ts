import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getDateRange } from '../src/cli-date.js'
import { clearSessionCache, parseAllSessions } from '../src/parser.js'
import { sessionCachePath } from '../src/session-cache.js'
import { isSqliteAvailable } from '../src/sqlite.js'
import type { DateRange } from '../src/types.js'

const requireForTest = createRequire(import.meta.url)

type Fixture = { conversationId: string; rows: Array<{ idx: number; hex: string }> }
type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

function createGenMetadataDb(dbPath: string, fixture: Fixture): void {
  const { DatabaseSync: Database } = requireForTest('node:sqlite')
  const db = new Database(dbPath) as TestDb
  try {
    db.exec('CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))')
    db.exec('CREATE TABLE trajectory_metadata_blob (id text DEFAULT "main", data blob, PRIMARY KEY (id))')
    db.prepare('INSERT INTO trajectory_metadata_blob (id, data) VALUES (?, ?)').run(
      'main',
      Buffer.from('file:///Users/example/private-project'),
    )
    for (const row of fixture.rows) {
      const data = Buffer.from(row.hex, 'hex')
      db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(row.idx, data, data.length)
    }
  } finally {
    db.close()
  }
}

async function cachedAntigravityTurns(cacheDir: string, dbPath: string): Promise<Array<{ timestamp: string }>> {
  const saved = JSON.parse(await readFile(sessionCachePath(), 'utf-8')) as {
    providers: Record<string, { files: Record<string, { turns: Array<{ timestamp: string }> }> }>
  }
  return saved.providers['antigravity']?.files[dbPath]?.turns ?? []
}

let home: string
let cacheDir: string
let previousHome: string | undefined
let previousUserProfile: string | undefined
let previousCacheDir: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'metrora-antigravity-ts-home-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'metrora-antigravity-ts-cache-'))
  previousHome = process.env['HOME']
  previousUserProfile = process.env['USERPROFILE']
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  // os.homedir() reads HOME on POSIX and USERPROFILE on Windows — set both so
  // discovery walks the temp home on either platform.
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
  process.env['METRORA_CACHE_DIR'] = cacheDir
})

afterEach(async () => {
  clearSessionCache()
  if (previousHome === undefined) delete process.env['HOME']
  else process.env['HOME'] = previousHome
  if (previousUserProfile === undefined) delete process.env['USERPROFILE']
  else process.env['USERPROFILE'] = previousUserProfile
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  await rm(home, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
})

describe('Antigravity timestamp stability across .db rewrites', () => {
  it('keeps a timeless call\'s first-seen timestamp when only the file mtime changes', async () => {
    if (!isSqliteAvailable()) return

    const fixture = JSON.parse(await readFile(
      new URL('./fixtures/antigravity-cli-current/gen-metadata.json', import.meta.url),
      'utf-8',
    )) as Fixture
    const conversationsDir = join(home, '.gemini', 'antigravity-ide', 'conversations')
    await mkdir(conversationsDir, { recursive: true })
    const dbPath = join(conversationsDir, `${fixture.conversationId}.db`)
    createGenMetadataDb(dbPath, fixture)

    // The fixture row carries no ChatStartMetadata.created_at, so the call
    // inherits the file mtime as its first-seen fallback. Pin it to July.
    const firstSeen = new Date('2026-07-02T03:04:05.000Z')
    await utimes(dbPath, firstSeen, firstSeen)

    const wideRange: DateRange = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-12-31T23:59:59.999Z'),
    }

    // First parse — through the generic parser + session-cache.
    await parseAllSessions(wideRange, 'antigravity')
    const firstTurns = await cachedAntigravityTurns(cacheDir, dbPath)
    expect(firstTurns.length).toBeGreaterThan(0)
    const firstTs = firstTurns[0]!.timestamp
    expect(Math.abs(new Date(firstTs).getTime() - firstSeen.getTime())).toBeLessThan(2000)

    // Cache hit — unchanged fingerprint, identical timestamp.
    clearSessionCache()
    await parseAllSessions(wideRange, 'antigravity')
    expect((await cachedAntigravityTurns(cacheDir, dbPath))[0]!.timestamp).toBe(firstTs)

    // Rewrite only the mtime to a much later day, then reparse. The non-durable
    // source is cleared and reparsed, but the dedup key must retain its
    // first-seen time rather than jumping to the new mtime.
    clearSessionCache()
    const rewritten = new Date('2026-07-07T08:09:10.000Z')
    await utimes(dbPath, rewritten, rewritten)
    await parseAllSessions(wideRange, 'antigravity')
    const afterRewrite = await cachedAntigravityTurns(cacheDir, dbPath)
    expect(afterRewrite[0]!.timestamp).toBe(firstTs)
    expect(Math.abs(new Date(afterRewrite[0]!.timestamp).getTime() - rewritten.getTime())).toBeGreaterThan(1000)

    // Date-range consequence: the first-seen month still includes the call
    // after the July rewrite, because its timestamp stayed in early July.
    clearSessionCache()
    const firstSeenMonthRange: DateRange = {
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-07-31T23:59:59.999Z'),
    }
    const firstSeenMonthProjects = await parseAllSessions(firstSeenMonthRange, 'antigravity')
    const firstSeenMonthKeys = firstSeenMonthProjects.flatMap(project =>
      project.sessions.flatMap(session =>
        session.turns.flatMap(turn => turn.assistantCalls.map(call => call.deduplicationKey)),
      ),
    )
    expect(firstSeenMonthKeys.length).toBeGreaterThan(0)

    // `today` must NOT include the call: first-seen is in July, not "now",
    // even though the file mtime was rewritten within July.
    clearSessionCache()
    const { range: todayRange } = getDateRange('today')
    const todayProjects = await parseAllSessions(todayRange, 'antigravity')
    const todayKeys = todayProjects.flatMap(project =>
      project.sessions.flatMap(session =>
        session.turns.flatMap(turn => turn.assistantCalls.map(call => call.deduplicationKey)),
      ),
    )
    expect(todayKeys).toHaveLength(0)
  })

  it('preserves durable orphan usage after source pruning and a cache fingerprint change', async () => {
    if (!isSqliteAvailable()) return

    const fixture = JSON.parse(await readFile(
      new URL('./fixtures/antigravity-cli-current/gen-metadata.json', import.meta.url),
      'utf-8',
    )) as Fixture
    const conversationsDir = join(home, '.gemini', 'antigravity-ide', 'conversations')
    await mkdir(conversationsDir, { recursive: true })
    const dbPath = join(conversationsDir, `${fixture.conversationId}.db`)
    createGenMetadataDb(dbPath, fixture)

    const wideRange: DateRange = {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-12-31T23:59:59.999Z'),
    }

    const firstProjects = await parseAllSessions(wideRange, 'antigravity')
    const firstKeys = firstProjects.flatMap(project =>
      project.sessions.flatMap(session =>
        session.turns.flatMap(turn => turn.assistantCalls.map(call => call.deduplicationKey)),
      ),
    )
    expect(firstKeys.length).toBeGreaterThan(0)

    const saved = JSON.parse(await readFile(sessionCachePath(), 'utf-8')) as {
      providers: Record<string, { envFingerprint: string; durable?: boolean }>
    }
    saved.providers['antigravity']!.envFingerprint = 'stale-antigravity-fingerprint'
    await writeFile(sessionCachePath(), JSON.stringify(saved))
    await rm(dbPath)

    clearSessionCache()
    const secondProjects = await parseAllSessions(wideRange, 'antigravity')
    const secondKeys = secondProjects.flatMap(project =>
      project.sessions.flatMap(session =>
        session.turns.flatMap(turn => turn.assistantCalls.map(call => call.deduplicationKey)),
      ),
    )

    expect(secondKeys).toEqual(firstKeys)
    expect((await cachedAntigravityTurns(cacheDir, dbPath)).length).toBeGreaterThan(0)
    const migrated = JSON.parse(await readFile(sessionCachePath(), 'utf-8')) as {
      providers: Record<string, { durable?: boolean }>
    }
    expect(migrated.providers['antigravity']?.durable).toBe(true)
  })
})
