import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { isSqliteAvailable } from '../../src/sqlite.js'
import {
  antigravityAppDataDirFromSourcePath,
  antigravityCascadeIdFromPath,
  buildCallsFromGeneratorMetadata,
  createAntigravityProvider,
  discoverAntigravitySessionSources,
  extractAntigravityAppDataDirFromLine,
  extractAntigravityGeneratorMetadata,
  extractAntigravityModelMap,
  flushAntigravityCache,
  getAntigravityStatusLineEventsPath,
  parseAntigravityServerInfo,
  parseAntigravityServerInfoFromLine,
  reconcileAntigravityStatusLineCalls,
  recordAntigravityStatusLinePayload,
  resetAntigravityMemoryCacheForTests,
  setAntigravityRpcDataForTests,
  snapshotAntigravityStatusLinePayload,
  shouldReparseAntigravitySource,
} from '../../src/providers/antigravity.js'
import type { ParsedProviderCall, SessionSource } from '../../src/providers/types.js'

const requireForTest = createRequire(import.meta.url)

type CurrentCliFixture = {
  conversationId: string
  rows: Array<{ idx: number; hex: string }>
}

type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

function createCurrentAntigravityCliDb(dbPath: string, fixture: CurrentCliFixture): void {
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

async function collectAntigravityCalls(source: SessionSource): Promise<ParsedProviderCall[]> {
  const parser = createAntigravityProvider().createSessionParser(source, new Set())
  const calls: ParsedProviderCall[] = []
  for await (const call of parser.parse()) calls.push(call)
  return calls
}

function rpcData(responseId: string) {
  return {
    metadata: [{
      chatModel: {
        model: 'gemini-3-pro',
        usage: {
          model: 'gemini-3-pro', inputTokens: '10', outputTokens: '4',
          apiProvider: 'google', responseId,
        },
      },
    }],
    modelMap: {},
  }
}

describe('antigravity provider helpers', () => {
  it('parses legacy https server flags from POSIX process args', () => {
    const server = parseAntigravityServerInfoFromLine(
      '/Applications/Antigravity.app/language_server_macos_arm --app_data_dir antigravity --https_server_port 57101 --csrf_token 01234567-89ab-cdef-0123-456789abcdef',
    )

    expect(server).toEqual({
      port: 57101,
      csrfToken: '01234567-89ab-cdef-0123-456789abcdef',
    })
  })

  it('parses Windows extension server flags and equals syntax', () => {
    const server = parseAntigravityServerInfoFromLine(
      'C:\\Users\\Admin\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows_x64.exe --extension_server_port=62225 --extension_server_csrf_token=abcdef01-2345-6789-abcd-ef0123456789',
    )

    expect(server).toEqual({
      port: 62225,
      csrfToken: 'abcdef01-2345-6789-abcd-ef0123456789',
    })
  })

  it('parses Windows extension server flags and space syntax', () => {
    const server = parseAntigravityServerInfo([
      'node something-unrelated',
      'language_server_windows_x64.exe --app_data_dir C:\\Users\\Admin\\.gemini\\antigravity --extension_server_port 62300 --extension_server_csrf_token fedcba98-7654-3210-fedc-ba9876543210',
    ])

    expect(server).toEqual({
      port: 62300,
      csrfToken: 'fedcba98-7654-3210-fedc-ba9876543210',
    })
  })

  it('parses quoted flag values', () => {
    const server = parseAntigravityServerInfoFromLine(
      'Antigravity language_server_windows_x64.exe --extension_server_port "62301" --extension_server_csrf_token "fedcba98-7654-3210-fedc-ba9876543211"',
    )

    expect(server).toEqual({
      port: 62301,
      csrfToken: 'fedcba98-7654-3210-fedc-ba9876543211',
    })
  })

  it('normalizes app_data_dir from app and CLI process args', () => {
    expect(extractAntigravityAppDataDirFromLine(
      'language_server --app_data_dir antigravity --https_server_port 0 --csrf_token 01234567-89ab-cdef-0123-456789abcdef',
    )).toBe('antigravity')

    expect(extractAntigravityAppDataDirFromLine(
      'language_server --app_data_dir /Users/dev/.gemini/antigravity-cli --https_server_port 0 --csrf_token 01234567-89ab-cdef-0123-456789abcdef',
    )).toBe('antigravity-cli')

    expect(extractAntigravityAppDataDirFromLine(
      'language_server.exe --app_data_dir "C:\\Users\\Admin\\.gemini\\antigravity-cli" --extension_server_port 62225 --extension_server_csrf_token abcdef01-2345-6789-abcd-ef0123456789',
    )).toBe('antigravity-cli')

    expect(extractAntigravityAppDataDirFromLine(
      'language_server_windows_x64.exe --app_data_dir antigravity-ide --extension_server_port 8720 --extension_server_csrf_token 39800f1b-343a-40b0-8eb5-850702450346',
    )).toBe('antigravity-ide')
  })

  it('accepts Antigravity 2 ephemeral port zero', () => {
    const server = parseAntigravityServerInfoFromLine(
      'antigravity language_server_macos_arm --https_server_port 0 --csrf_token 01234567-89ab-cdef-0123-456789abcdef',
    )

    expect(server).toEqual({
      port: 0,
      csrfToken: '01234567-89ab-cdef-0123-456789abcdef',
    })
  })

  it('matches language-server and antigravity markers case-insensitively', () => {
    const server = parseAntigravityServerInfoFromLine(
      'ANTIGRAVITY LANGUAGE_SERVER_WINDOWS_X64.EXE --extension_server_port 62302 --extension_server_csrf_token fedcba98-7654-3210-fedc-ba9876543212',
    )

    expect(server).toEqual({
      port: 62302,
      csrfToken: 'fedcba98-7654-3210-fedc-ba9876543212',
    })
  })

  it('ignores process args without an antigravity marker', () => {
    expect(parseAntigravityServerInfoFromLine(
      'language_server --extension_server_port 62300 --extension_server_csrf_token fedcba98-7654-3210-fedc-ba9876543210',
    )).toBeNull()
  })

  it('ignores invalid ports', () => {
    expect(parseAntigravityServerInfoFromLine(
      'antigravity language_server --extension_server_port 99999 --extension_server_csrf_token fedcba98-7654-3210-fedc-ba9876543210',
    )).toBeNull()
  })

  it('ignores chained flag names as values', () => {
    expect(parseAntigravityServerInfoFromLine(
      'antigravity language_server --extension_server_port=--extension_server_csrf_token --extension_server_csrf_token fedcba98-7654-3210-fedc-ba9876543210',
    )).toBeNull()
  })

  it('ignores implausibly short CSRF tokens', () => {
    expect(parseAntigravityServerInfoFromLine(
      'antigravity language_server --extension_server_port 62300 --extension_server_csrf_token short',
    )).toBeNull()
  })

  it('extracts model maps from wrapped and unwrapped RPC responses', () => {
    expect(extractAntigravityModelMap({
      response: { models: { high: { model: 'MODEL_PLACEHOLDER_M7' } } },
    })).toEqual({ MODEL_PLACEHOLDER_M7: 'high' })

    expect(extractAntigravityModelMap({
      models: { low: { model: 'MODEL_PLACEHOLDER_M8' } },
    })).toEqual({ MODEL_PLACEHOLDER_M8: 'low' })
    expect(extractAntigravityModelMap({
      models: { bad: null, good: { model: 'MODEL_PLACEHOLDER_M9' } },
    })).toEqual({ MODEL_PLACEHOLDER_M9: 'good' })
    expect(extractAntigravityModelMap({
      models: { 'gemini-3-flash-agent': { model: 'MODEL_PLACEHOLDER_M133', displayName: 'Gemini 3.5 Flash (High)' } },
    })).toEqual({ MODEL_PLACEHOLDER_M133: 'gemini-3.5-flash-high' })
    expect(extractAntigravityModelMap(null)).toEqual({})
  })

  it('never leaks a raw MODEL_PLACEHOLDER id as the canonical model name', () => {
    // The config key itself is still the unresolved placeholder (Antigravity
    // hasn't shipped a friendly key/displayName for this model yet).
    expect(extractAntigravityModelMap({
      models: { MODEL_PLACEHOLDER_M26: { model: 'MODEL_PLACEHOLDER_M26' } },
    })).toEqual({ MODEL_PLACEHOLDER_M26: 'unknown' })
  })

  it('extracts generator metadata from wrapped and unwrapped RPC responses', () => {
    const metadata = [{
      chatModel: {
        model: 'gemini-3-pro',
        usage: {
          model: 'gemini-3-pro',
          inputTokens: '10',
          outputTokens: '4',
          apiProvider: 'google',
        },
      },
    }]

    expect(extractAntigravityGeneratorMetadata({ response: { generatorMetadata: metadata } })).toEqual(metadata)
    expect(extractAntigravityGeneratorMetadata({ generatorMetadata: metadata })).toEqual(metadata)
    expect(extractAntigravityGeneratorMetadata({ response: { generatorMetadata: null } })).toEqual([])
    expect(extractAntigravityGeneratorMetadata(null)).toEqual([])
  })

  it('retains the explicit generator provider on normalized calls', () => {
    const calls = buildCallsFromGeneratorMetadata('cascade-1', [{
      chatModel: {
        model: 'gemini-3-pro',
        usage: {
          model: 'gemini-3-pro',
          inputTokens: '10',
          outputTokens: '4',
          responseOutputTokens: '4',
          apiProvider: 'Google',
        },
      },
    }], {})

    expect(calls).toHaveLength(1)
    expect(calls[0]!.modelProvider).toBe('google')
  })

  it('preserves cache reads and total output for legacy direct generator usage', () => {
    const calls = buildCallsFromGeneratorMetadata('cascade-legacy', [{
      chatModel: {
        model: 'gemini-3-pro',
        usage: {
          model: 'gemini-3-pro',
          inputTokens: '10',
          outputTokens: '4',
          cacheReadTokens: '30',
          apiProvider: 'Google',
          responseId: 'legacy-response',
        },
      },
    }], {})

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: 30,
      reasoningTokens: 0,
      modelProvider: 'google',
      deduplicationKey: 'antigravity:cascade-legacy:legacy-response',
    })
  })

  it('supports retryInfos usage without replacing or duplicating old metadata', () => {
    const calls = buildCallsFromGeneratorMetadata('cascade-retries', [{
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M8',
        responseModel: 'gemini-3.6-flash',
        usage: {
          model: 'gemini-3.6-flash', inputTokens: '5', outputTokens: '2',
          apiProvider: 'google', responseId: 'shared-response',
        },
        retryInfos: [
          { usage: {
            inputTokens: '5', outputTokens: '2', cacheReadTokens: '11',
            thinkingOutputTokens: '1', responseOutputTokens: '1',
            apiProvider: 'google', responseId: 'shared-response',
          } },
          { usage: {
            inputTokens: 7, outputTokens: 4, cacheReadTokens: 13,
            thinkingOutputTokens: 1, responseOutputTokens: 3,
            apiProvider: 'google', responseId: 'retry-response',
            timestamp: 1786123456789,
          } },
        ],
      },
    }], {})

    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      model: 'gemini-3.6-flash',
      modelProvider: 'google',
      inputTokens: 7,
      outputTokens: 3,
      reasoningTokens: 1,
      cacheReadInputTokens: 13,
      deduplicationKey: 'antigravity:cascade-retries:retry-response',
      timestamp: new Date(1786123456789).toISOString(),
    })
  })

  it('retains generator records with reasoning but no input/output', () => {
    const calls = buildCallsFromGeneratorMetadata('cascade-reasoning', [{
      chatModel: {
        model: 'gemini-3-pro',
        usage: {
          model: 'gemini-3-pro',
          inputTokens: '0',
          outputTokens: '0',
          responseOutputTokens: '0',
          thinkingOutputTokens: '3',
          apiProvider: 'google',
        },
      },
    }], {})

    expect(calls).toHaveLength(1)
    expect(calls[0]!.reasoningTokens).toBe(3)
  })

  it('derives cascade ids from legacy .pb and Antigravity 2 .db files', () => {
    expect(antigravityCascadeIdFromPath('/tmp/123.pb')).toBe('123')
    expect(antigravityCascadeIdFromPath('/tmp/456.db')).toBe('456')
    expect(antigravityCascadeIdFromPath('/tmp/789.db-wal')).toBe('789.db-wal')
  })

  it('routes app and CLI source paths to matching Antigravity app data dirs', () => {
    expect(antigravityAppDataDirFromSourcePath(
      '/Users/dev/.gemini/antigravity/conversations/session.db',
    )).toBe('antigravity')

    expect(antigravityAppDataDirFromSourcePath(
      '/Users/dev/.gemini/antigravity-cli/conversations/session.pb',
    )).toBe('antigravity-cli')

    expect(antigravityAppDataDirFromSourcePath(
      'C:\\Users\\Admin\\.gemini\\antigravity-cli\\implicit\\session.pb',
    )).toBe('antigravity-cli')

    expect(antigravityAppDataDirFromSourcePath(
      '/Users/dev/.gemini/antigravity-ide/conversations/session.db',
    )).toBe('antigravity-ide')

    expect(antigravityAppDataDirFromSourcePath(
      'C:\\Users\\Admin\\.gemini\\antigravity-ide\\implicit\\session.pb',
    )).toBe('antigravity-ide')
  })

  it('discovers legacy .pb files and Antigravity 2 .db files only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-antigravity-'))

    try {
      await writeFile(join(dir, 'legacy.pb'), '')
      await writeFile(join(dir, 'antigravity-2.db'), '')
      await writeFile(join(dir, 'uppercase.DB'), '')
      await writeFile(join(dir, 'antigravity-2.db-wal'), '')
      await mkdir(join(dir, 'directory.pb'))

      const sources = await discoverAntigravitySessionSources([{
        dir,
        project: 'test-project',
        extensions: ['.pb', '.db'],
      }])

      expect(sources).toEqual([
        { path: join(dir, 'antigravity-2.db'), project: 'test-project', provider: 'antigravity' },
        { path: join(dir, 'legacy.pb'), project: 'test-project', provider: 'antigravity' },
        { path: join(dir, 'uppercase.DB'), project: 'test-project', provider: 'antigravity' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('discovers antigravity-ide conversation and implicit files', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'metrora-home-'))
    const conversationsDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')
    const implicitDir = join(tempHome, '.gemini', 'antigravity-ide', 'implicit')

    await mkdir(conversationsDir, { recursive: true })
    await mkdir(implicitDir, { recursive: true })

    await writeFile(join(conversationsDir, 'session1.db'), '')
    await writeFile(join(implicitDir, 'session2.pb'), '')

    const roots = [
      {
        dir: conversationsDir,
        project: 'antigravity-ide',
        extensions: ['.pb', '.db'] as const,
      },
      {
        dir: implicitDir,
        project: 'antigravity-ide',
        extensions: ['.pb'] as const,
      },
    ]

    const sources = await discoverAntigravitySessionSources(roots)
    expect(sources).toEqual([
      { path: join(conversationsDir, 'session1.db'), project: 'antigravity-ide', provider: 'antigravity' },
      { path: join(implicitDir, 'session2.pb'), project: 'antigravity-ide', provider: 'antigravity' },
    ])

    await rm(tempHome, { recursive: true, force: true })
  })

  it('unions real roots by native cascade identity and exposes the same roots to doctor', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'metrora-antigravity-root-union-'))
    const cacheDir = join(tempHome, 'cache')
    const previousHome = process.env['HOME']
    const previousUserProfile = process.env['USERPROFILE']
    const previousCacheDir = process.env['METRORA_CACHE_DIR']

    try {
      process.env['HOME'] = tempHome
      process.env['USERPROFILE'] = tempHome
      process.env['METRORA_CACHE_DIR'] = cacheDir

      const appConversations = join(tempHome, '.gemini', 'antigravity', 'conversations')
      const appImplicit = join(tempHome, '.gemini', 'antigravity', 'implicit')
      const ideConversations = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')
      const ideImplicit = join(tempHome, '.gemini', 'antigravity-ide', 'implicit')
      await Promise.all([
        mkdir(appConversations, { recursive: true }),
        mkdir(appImplicit, { recursive: true }),
        mkdir(ideConversations, { recursive: true }),
        mkdir(ideImplicit, { recursive: true }),
      ])

      // The SQLite source is authoritative over a same-ID protobuf copy.
      await writeFile(join(appConversations, 'shared-cascade.pb'), '')
      await writeFile(join(ideConversations, 'shared-cascade.db'), '')
      // Identical implicit mirrors collapse to one native cascade as well.
      await writeFile(join(appImplicit, 'implicit-cascade.pb'), '')
      await writeFile(join(ideImplicit, 'implicit-cascade.pb'), '')

      const sources = await discoverAntigravitySessionSources()
      expect(sources.filter(source => antigravityCascadeIdFromPath(source.path) === 'shared-cascade')).toEqual([
        {
          path: join(ideConversations, 'shared-cascade.db'), project: 'antigravity-ide', provider: 'antigravity',
          alternateLocators: [{ path: join(appConversations, 'shared-cascade.pb'), project: 'antigravity', provider: 'antigravity' }],
        },
      ])
      expect(sources.filter(source => antigravityCascadeIdFromPath(source.path) === 'implicit-cascade')).toEqual([
        {
          path: join(appImplicit, 'implicit-cascade.pb'), project: 'antigravity', provider: 'antigravity',
          alternateLocators: [{ path: join(ideImplicit, 'implicit-cascade.pb'), project: 'antigravity-ide', provider: 'antigravity' }],
        },
      ])

      const roots = await createAntigravityProvider().probeRoots?.()
      expect(roots?.map(root => root.label)).toEqual([
        'conversations', 'implicit',
        'conversations', 'implicit',
        'conversations', 'implicit',
        'statusline',
      ])
      expect(roots?.at(-1)?.path).toBe(join(cacheDir, 'antigravity-statusline.jsonl'))
    } finally {
      if (previousHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = previousHome
      if (previousUserProfile === undefined) delete process.env['USERPROFILE']
      else process.env['USERPROFILE'] = previousUserProfile
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(tempHome, { recursive: true, force: true })
    }
  })

  it('keeps alternate PB locators and falls back across appDataDir without double counting', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'metrora-antigravity-rpc-locators-'))
    const previousHome = process.env['HOME']
    const previousUserProfile = process.env['USERPROFILE']
    const previousCacheDir = process.env['METRORA_CACHE_DIR']
    const cacheDir = join(tempHome, 'cache')

    try {
      process.env['HOME'] = tempHome
      process.env['USERPROFILE'] = tempHome
      process.env['METRORA_CACHE_DIR'] = cacheDir
      const appDir = join(tempHome, '.gemini', 'antigravity', 'conversations')
      const ideDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')
      await mkdir(appDir, { recursive: true })
      await mkdir(ideDir, { recursive: true })

      for (const id of ['pb-fallback', 'pb-both', 'pb-blocked']) {
        await writeFile(join(appDir, `${id}.pb`), '')
        await writeFile(join(ideDir, `${id}.pb`), '')
      }

      const roots = [
        { dir: appDir, project: 'antigravity', extensions: ['.pb'] as const },
        { dir: ideDir, project: 'antigravity-ide', extensions: ['.pb'] as const },
      ]
      const discovered = await discoverAntigravitySessionSources(roots)
      const fallbackSource = discovered.find(source => antigravityCascadeIdFromPath(source.path) === 'pb-fallback')!
      expect(fallbackSource.alternateLocators).toEqual([{
        path: join(ideDir, 'pb-fallback.pb'), project: 'antigravity-ide', provider: 'antigravity',
      }])

      const attempts: string[] = []
      setAntigravityRpcDataForTests(async (appDataDir, cascadeId) => {
        attempts.push(`${cascadeId}:${appDataDir}`)
        if (cascadeId === 'pb-fallback') {
          return appDataDir === 'antigravity-ide' ? rpcData('fallback-response') : null
        }
        if (cascadeId === 'pb-both') return rpcData('both-response')
        return null
      })

      const fallbackCalls = await collectAntigravityCalls(fallbackSource)
      expect(fallbackCalls).toHaveLength(1)
      expect(fallbackCalls[0]!.deduplicationKey).toBe('antigravity:pb-fallback:fallback-response')
      expect(attempts).toEqual(['pb-fallback:antigravity', 'pb-fallback:antigravity-ide'])

      attempts.length = 0
      const bothSource = discovered.find(source => antigravityCascadeIdFromPath(source.path) === 'pb-both')!
      const bothCalls = await collectAntigravityCalls(bothSource)
      expect(bothCalls).toHaveLength(1)
      expect(attempts).toEqual(['pb-both:antigravity'])

      attempts.length = 0
      const blockedSource = discovered.find(source => antigravityCascadeIdFromPath(source.path) === 'pb-blocked')!
      expect(await collectAntigravityCalls(blockedSource)).toEqual([])
      expect(attempts).toEqual(['pb-blocked:antigravity', 'pb-blocked:antigravity-ide'])
    } finally {
      resetAntigravityMemoryCacheForTests()
      if (previousHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = previousHome
      if (previousUserProfile === undefined) delete process.env['USERPROFILE']
      else process.env['USERPROFILE'] = previousUserProfile
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(tempHome, { recursive: true, force: true })
    }
  })

  it('keeps SQLite primary and uses an alternate RPC locator when the DB has no usage', async () => {
    if (!isSqliteAvailable()) return

    const tempHome = await mkdtemp(join(tmpdir(), 'metrora-antigravity-db-rpc-'))
    const previousCacheDir = process.env['METRORA_CACHE_DIR']
    process.env['METRORA_CACHE_DIR'] = join(tempHome, 'cache')
    const appDir = join(tempHome, '.gemini', 'antigravity', 'conversations')
    const ideDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')

    try {
      await mkdir(appDir, { recursive: true })
      await mkdir(ideDir, { recursive: true })
      const fixture = JSON.parse(await readFile(
        new URL('../fixtures/antigravity-cli-current/gen-metadata.json', import.meta.url),
        'utf-8',
      )) as CurrentCliFixture
      const primaryDb = join(appDir, `${fixture.conversationId}.db`)
      createCurrentAntigravityCliDb(primaryDb, fixture)
      await writeFile(join(ideDir, `${fixture.conversationId}.pb`), '')

      const emptyId = 'empty-db-rpc-fallback'
      const emptyDb = join(appDir, `${emptyId}.db`)
      createCurrentAntigravityCliDb(emptyDb, { conversationId: emptyId, rows: [] })
      await writeFile(join(ideDir, `${emptyId}.pb`), '')
      const roots = [
        { dir: appDir, project: 'antigravity', extensions: ['.db'] as const },
        { dir: ideDir, project: 'antigravity-ide', extensions: ['.pb'] as const },
      ]
      const sources = await discoverAntigravitySessionSources(roots)
      const primarySource = sources.find(source => antigravityCascadeIdFromPath(source.path) === fixture.conversationId)!
      const emptySource = sources.find(source => antigravityCascadeIdFromPath(source.path) === emptyId)!
      const attempts: string[] = []

      setAntigravityRpcDataForTests(async (appDataDir, cascadeId) => {
        attempts.push(`${cascadeId}:${appDataDir}`)
        return cascadeId === emptyId && appDataDir === 'antigravity-ide'
          ? rpcData('empty-db-rpc-response')
          : null
      })

      const primaryCalls = await collectAntigravityCalls(primarySource)
      expect(primaryCalls).toHaveLength(1)
      expect(primaryCalls[0]!.deduplicationKey).toContain(`${fixture.conversationId}:fixture-response-1`)
      expect(attempts).toEqual([])

      const emptyCalls = await collectAntigravityCalls(emptySource)
      expect(emptyCalls).toHaveLength(1)
      expect(emptyCalls[0]!.deduplicationKey).toBe(`antigravity:${emptyId}:empty-db-rpc-response`)
      expect(attempts).toEqual([`${emptyId}:antigravity`, `${emptyId}:antigravity-ide`])
    } finally {
      resetAntigravityMemoryCacheForTests()
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(tempHome, { recursive: true, force: true })
    }
  })

  it('finds an IDE alternate locator for the statusline snapshot path', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'metrora-antigravity-statusline-locator-'))
    const previousHome = process.env['HOME']
    const previousUserProfile = process.env['USERPROFILE']
    const previousCacheDir = process.env['METRORA_CACHE_DIR']
    const cacheDir = join(tempHome, 'cache')

    try {
      process.env['HOME'] = tempHome
      process.env['USERPROFILE'] = tempHome
      process.env['METRORA_CACHE_DIR'] = cacheDir
      const appDir = join(tempHome, '.gemini', 'antigravity', 'conversations')
      const ideDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')
      await mkdir(appDir, { recursive: true })
      await mkdir(ideDir, { recursive: true })
      await writeFile(join(appDir, 'statusline-shared.pb'), '')
      await writeFile(join(ideDir, 'statusline-shared.pb'), '')

      const attempts: string[] = []
      setAntigravityRpcDataForTests(async appDataDir => {
        attempts.push(appDataDir)
        return appDataDir === 'antigravity-ide' ? rpcData('statusline-response') : null
      })

      expect(await snapshotAntigravityStatusLinePayload({
        conversation_id: 'statusline-shared',
        model: 'gemini-3-pro',
        context_window: { current_usage: { input_tokens: 10, output_tokens: 4 } },
      })).toBe(true)
      expect(attempts).toEqual(['antigravity-ide'])
    } finally {
      resetAntigravityMemoryCacheForTests()
      if (previousHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = previousHome
      if (previousUserProfile === undefined) delete process.env['USERPROFILE']
      else process.env['USERPROFILE'] = previousUserProfile
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(tempHome, { recursive: true, force: true })
    }
  })

  it('displays Gemini 3.5 Flash thinking variants as the base model', () => {
    const provider = createAntigravityProvider()

    expect(provider.modelDisplayName('gemini-3.5-flash')).toBe('Gemini 3.5 Flash')
    expect(provider.modelDisplayName('gemini-3.5-flash-high')).toBe('Gemini 3.5 Flash')
    expect(provider.modelDisplayName('gemini-3.5-flash-medium')).toBe('Gemini 3.5 Flash')
    expect(provider.modelDisplayName('gemini-3.5-flash-low')).toBe('Gemini 3.5 Flash')
    expect(provider.modelDisplayName('Gemini 3.5 Flash (High)')).toBe('Gemini 3.5 Flash')
  })

  it('captures exact Antigravity CLI statusLine usage as fallback calls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-antigravity-statusline-'))
    process.env['METRORA_CACHE_DIR'] = dir

    try {
      const payload = {
        conversation_id: 'ce061468-2e2b-4c6f-bf4f-e072bd5fa986',
        session_id: 'session-1',
        cwd: '/workspace/project',
        model: {
          id: 'Gemini 3.5 Flash (High)',
          display_name: 'Gemini 3.5 Flash (High)',
        },
        context_window: {
          current_usage: {
            input_tokens: 28407,
            output_tokens: 137,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }

      expect(await recordAntigravityStatusLinePayload(payload)).toBe(true)
      expect(await recordAntigravityStatusLinePayload(payload)).toBe(true)

      const recorded = await readFile(getAntigravityStatusLineEventsPath(), 'utf-8')
      expect(recorded).not.toContain('/workspace/project')
      expect(JSON.parse(recorded.split(/\r?\n/)[0]!)).not.toHaveProperty('cwd')

      const source = {
        path: getAntigravityStatusLineEventsPath(),
        project: 'antigravity-cli',
        provider: 'antigravity',
      }

      const parser = createAntigravityProvider().createSessionParser(source, new Set())
      const calls = []
      for await (const call of parser.parse()) calls.push(call)

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        provider: 'antigravity',
        model: 'Gemini 3.5 Flash (High)',
        inputTokens: 28407,
        outputTokens: 137,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cachedInputTokens: 0,
        sessionId: 'ce061468-2e2b-4c6f-bf4f-e072bd5fa986',
        project: 'antigravity-cli',
      })
      expect(calls[0]!.projectPath).toBeUndefined()
      expect(calls[0]!.costUSD).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips statusLine fallback calls when RPC cache already covered the conversation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-antigravity-statusline-rpc-dedup-'))
    process.env['METRORA_CACHE_DIR'] = dir

    try {
      expect(await recordAntigravityStatusLinePayload({
        conversation_id: 'rpc-covered-conversation',
        session_id: 'session-1',
        model: 'Gemini 3.5 Flash (High)',
        context_window: {
          current_usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      })).toBe(true)

      const parser = createAntigravityProvider().createSessionParser({
        path: getAntigravityStatusLineEventsPath(),
        project: 'antigravity-cli',
        provider: 'antigravity',
      }, new Set(['antigravity:rpc-covered-conversation:0']))

      const calls = []
      for await (const call of parser.parse()) calls.push(call)

      expect(calls).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps Status Line cache enrichment out of API and model call cardinality', () => {
    const direct: ParsedProviderCall[] = [{
      provider: 'antigravity', model: 'gemini-3.5-flash-high', modelProvider: 'google',
      inputTokens: 100, outputTokens: 40, reasoningTokens: 10,
      cacheCreationInputTokens: 0, cacheReadInputTokens: 20, cachedInputTokens: 0,
      webSearchRequests: 0, costUSD: 1, tools: [], bashCommands: [],
      timestamp: '2026-08-01T00:00:00.000Z', speed: 'standard',
      deduplicationKey: 'antigravity:conversation:response', userMessage: '', sessionId: 'conversation',
    }]
    const status: ParsedProviderCall[] = [{
      ...direct[0]!, model: 'Gemini 3.5 Flash (High)', modelProvider: undefined,
      outputTokens: 50, reasoningTokens: 0, cacheCreationInputTokens: 5, cacheReadInputTokens: 30,
      deduplicationKey: 'antigravity-statusline:conversation:0:signature',
      timestamp: '2026-08-01T00:01:00.000Z', project: 'antigravity-cli',
    }]

    const enrichment = reconcileAntigravityStatusLineCalls(direct, status)
    expect(enrichment).toEqual([{
      model: 'gemini-3.5-flash-high', modelProvider: 'google',
      cacheCreationInputTokens: 5, cacheReadInputTokens: 10,
    }])
    expect(enrichment[0]).not.toHaveProperty('inputTokens')
    expect(enrichment[0]).not.toHaveProperty('outputTokens')
    expect(enrichment[0]).not.toHaveProperty('costUSD')
    expect(direct).toHaveLength(1)
    expect(direct[0]).toMatchObject({
      model: 'gemini-3.5-flash-high', inputTokens: 100, outputTokens: 40,
      cacheCreationInputTokens: 0, cacheReadInputTokens: 20,
    })
    expect(reconcileAntigravityStatusLineCalls([
      { ...direct[0]!, cacheCreationInputTokens: 5, cacheReadInputTokens: 30 },
    ], status)).toEqual([])
  })

  it('does not cross-match mixed Gemini high, medium, low, or agent identities', () => {
    const variants = [
      { directModel: 'gemini-3.5-flash-high', statusModel: 'Gemini 3.5 Flash (High)', input: 100, output: 40, read: 20 },
      { directModel: 'gemini-3.5-flash-medium', statusModel: 'Gemini 3.5 Flash (Medium)', input: 200, output: 50, read: 30 },
      { directModel: 'gemini-3.5-flash-low', statusModel: 'Gemini 3.5 Flash (Low)', input: 300, output: 60, read: 40 },
      { directModel: 'gemini-3-flash-agent', statusModel: 'Gemini 3 Flash (Agent)', input: 400, output: 70, read: 50 },
    ]
    const direct: ParsedProviderCall[] = variants.map((variant, index) => ({
      provider: 'antigravity', model: variant.directModel, modelProvider: 'google',
      inputTokens: variant.input, outputTokens: variant.output, reasoningTokens: 0,
      cacheCreationInputTokens: 0, cacheReadInputTokens: variant.read, cachedInputTokens: 0,
      webSearchRequests: 0, costUSD: 1, tools: [], bashCommands: [],
      timestamp: `2026-08-01T00:0${index}:00.000Z`, speed: 'standard',
      deduplicationKey: `antigravity:conversation:response-${index}`, userMessage: '', sessionId: 'conversation',
    }))
    const status: ParsedProviderCall[] = variants.map((variant, index) => ({
      ...direct[index]!, model: variant.statusModel, modelProvider: undefined,
      cacheCreationInputTokens: 5, cacheReadInputTokens: variant.read + 10,
      deduplicationKey: `antigravity-statusline:conversation:${index}:signature`,
      timestamp: `2026-08-01T01:0${index}:00.000Z`, project: 'antigravity-cli',
    }))

    expect(reconcileAntigravityStatusLineCalls(direct, status)).toEqual(
      variants.map(variant => ({
        model: variant.directModel, modelProvider: 'google',
        cacheCreationInputTokens: 5, cacheReadInputTokens: 10,
      })),
    )
  })

  it('skips singleton statusLine snapshots and deltas monotonic usage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-antigravity-statusline-runs-'))
    process.env['METRORA_CACHE_DIR'] = dir

    const basePayload = {
      conversation_id: 'statusline-runs',
      session_id: 'session-1',
      model: 'Gemini 3.5 Flash (High)',
    }

    const withUsage = (
      input_tokens: number,
      output_tokens: number,
      cache_read_input_tokens = 0,
    ) => ({
      ...basePayload,
      context_window: {
        current_usage: {
          input_tokens,
          output_tokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens,
        },
      },
    })

    try {
      expect(await recordAntigravityStatusLinePayload(withUsage(100, 10))).toBe(true)
      expect(await recordAntigravityStatusLinePayload(withUsage(200, 20))).toBe(true)
      expect(await recordAntigravityStatusLinePayload(withUsage(200, 20))).toBe(true)
      expect(await recordAntigravityStatusLinePayload(withUsage(300, 30, 50))).toBe(true)

      const parser = createAntigravityProvider().createSessionParser({
        path: getAntigravityStatusLineEventsPath(),
        project: 'antigravity-cli',
        provider: 'antigravity',
      }, new Set())

      const calls = []
      for await (const call of parser.parse()) calls.push(call)

      expect(calls).toHaveLength(2)
      expect(calls.map(call => [call.inputTokens, call.outputTokens, call.cacheReadInputTokens])).toEqual([
        [200, 20, 0],
        [100, 10, 50],
      ])
      expect(calls.map(call => call.cachedInputTokens)).toEqual([0, 0])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats non-monotonic statusLine usage as a new request snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-antigravity-statusline-reset-'))
    process.env['METRORA_CACHE_DIR'] = dir

    const payload = (
      input_tokens: number,
      output_tokens: number,
      cache_read_input_tokens = 0,
    ) => ({
      conversation_id: 'statusline-reset',
      session_id: 'session-1',
      model: 'Gemini 3.5 Flash (High)',
      context_window: {
        current_usage: {
          input_tokens,
          output_tokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens,
        },
      },
    })

    try {
      expect(await recordAntigravityStatusLinePayload(payload(1000, 100))).toBe(true)
      expect(await recordAntigravityStatusLinePayload(payload(1000, 100))).toBe(true)
      expect(await recordAntigravityStatusLinePayload(payload(200, 30, 500))).toBe(true)

      const parser = createAntigravityProvider().createSessionParser({
        path: getAntigravityStatusLineEventsPath(),
        project: 'antigravity-cli',
        provider: 'antigravity',
      }, new Set())

      const calls = []
      for await (const call of parser.parse()) calls.push(call)

      expect(calls).toHaveLength(2)
      expect(calls.map(call => [call.inputTokens, call.outputTokens, call.cacheReadInputTokens])).toEqual([
        [1000, 100, 0],
        [200, 30, 500],
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('always reparses append-only statusLine sources but not unchanged cached cascades', () => {
    const statusLinePath = getAntigravityStatusLineEventsPath()

    expect(shouldReparseAntigravitySource(statusLinePath, 1)).toBe(true)
    expect(shouldReparseAntigravitySource('/tmp/antigravity/conversation.pb', 0)).toBe(true)
    expect(shouldReparseAntigravitySource('/tmp/antigravity/conversation.pb', 1)).toBe(false)
  })

  it('parses current Antigravity CLI SQLite conversations with non-zero token usage', async () => {
    if (!isSqliteAvailable()) return

    const tempHome = await mkdtemp(join(tmpdir(), 'metrora-antigravity-current-cli-'))
    const cacheDir = join(tempHome, 'cache')
    const previousCacheDir = process.env['METRORA_CACHE_DIR']
    process.env['METRORA_CACHE_DIR'] = cacheDir

    try {
      const fixture = JSON.parse(await readFile(
        new URL('../fixtures/antigravity-cli-current/gen-metadata.json', import.meta.url),
        'utf-8',
      )) as CurrentCliFixture
      const conversationsDir = join(tempHome, '.gemini', 'antigravity-cli', 'conversations')
      const logsDir = join(
        tempHome,
        '.gemini',
        'antigravity-cli',
        'brain',
        fixture.conversationId,
        '.system_generated',
        'logs',
      )

      await mkdir(conversationsDir, { recursive: true })
      await mkdir(logsDir, { recursive: true })
      await writeFile(
        join(logsDir, 'transcript.jsonl'),
        await readFile(
          new URL(
            '../fixtures/antigravity-cli-current/brain/fixture-current-cli/.system_generated/logs/transcript.jsonl',
            import.meta.url,
          ),
          'utf-8',
        ),
      )

      const dbPath = join(conversationsDir, `${fixture.conversationId}.db`)
      createCurrentAntigravityCliDb(dbPath, fixture)

      const sources = await discoverAntigravitySessionSources([{
        dir: conversationsDir,
        project: 'antigravity-cli',
        extensions: ['.pb', '.db'],
      }])
      expect(sources).toEqual([{ path: dbPath, project: 'antigravity-cli', provider: 'antigravity' }])

      const calls = await collectAntigravityCalls(sources[0]!)

      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0]).toMatchObject({
        provider: 'antigravity',
        model: 'gemini-3.1-pro-high',
        inputTokens: 31281,
        outputTokens: 659,
        reasoningTokens: 71,
        sessionId: fixture.conversationId,
        project: 'antigravity-cli',
      })
      expect(calls[0]!.projectPath).toBeUndefined()
      expect(calls[0]!.costUSD).toBeGreaterThan(0)
    } finally {
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(tempHome, { recursive: true, force: true })
    }
  })

  it('deduplicates current SQLite rows against RPC response ids with hyphens', async () => {
    if (!isSqliteAvailable()) return

    const tempHome = await mkdtemp(join(tmpdir(), 'metrora-antigravity-current-cli-dedup-'))
    const cacheDir = join(tempHome, 'cache')
    const previousCacheDir = process.env['METRORA_CACHE_DIR']
    process.env['METRORA_CACHE_DIR'] = cacheDir

    try {
      const fixture = JSON.parse(await readFile(
        new URL('../fixtures/antigravity-cli-current/gen-metadata.json', import.meta.url),
        'utf-8',
      )) as CurrentCliFixture
      const conversationsDir = join(tempHome, '.gemini', 'antigravity-cli', 'conversations')

      await mkdir(conversationsDir, { recursive: true })

      const dbPath = join(conversationsDir, `${fixture.conversationId}.db`)
      createCurrentAntigravityCliDb(dbPath, fixture)

      const parser = createAntigravityProvider().createSessionParser({
        path: dbPath,
        project: 'antigravity-cli',
        provider: 'antigravity',
      }, new Set([`antigravity:${fixture.conversationId}:fixture-response-1`]))
      const calls = []
      for await (const call of parser.parse()) calls.push(call)

      expect(calls).toEqual([])
    } finally {
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(tempHome, { recursive: true, force: true })
    }
  })

  async function withTempAntigravityHome(prefix: string, fn: (tempHome: string) => Promise<void>): Promise<void> {
    const tempHome = await mkdtemp(join(tmpdir(), prefix))
    const previousCacheDir = process.env['METRORA_CACHE_DIR']
    process.env['METRORA_CACHE_DIR'] = join(tempHome, 'cache')
    try {
      await fn(tempHome)
    } finally {
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(tempHome, { recursive: true, force: true })
    }
  }

  it('characterizes protobuf usage fields #1/#2/#5/#9/#10/#11', async () => {
    if (!isSqliteAvailable()) return

    await withTempAntigravityHome('metrora-antigravity-fields-', async (tempHome) => {
      const varint = (n: number): number[] => {
        const out: number[] = []
        let value = n
        while (value > 0x7f) { out.push((value & 0x7f) | 0x80); value = Math.floor(value / 128) }
        out.push(value)
        return out
      }
      const field = (number: number, value: number): number[] => [...varint(number * 8), ...varint(value)]
      const bytes = (number: number, value: number[] | Uint8Array): number[] => [
        ...varint(number * 8 + 2), ...varint(value.length), ...value,
      ]
      const usage = [
        ...field(1, 100), ...field(2, 200), ...field(3, 50), ...field(5, 700),
        ...field(9, 30), ...field(10, 20), ...bytes(11, new TextEncoder().encode('response-fields')),
      ]
      const chat = [...bytes(4, usage), ...bytes(19, new TextEncoder().encode('gemini-3.6-flash'))]
      const conversationsDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')
      await mkdir(conversationsDir, { recursive: true })
      const dbPath = join(conversationsDir, 'field-session.db')
      createCurrentAntigravityCliDb(dbPath, {
        conversationId: 'field-session', rows: [{ idx: 0, hex: Buffer.from(bytes(1, chat)).toString('hex') }],
      })

      const calls = await collectAntigravityCalls({ path: dbPath, project: 'antigravity-ide', provider: 'antigravity' })
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        inputTokens: 300,
        outputTokens: 30,
        reasoningTokens: 20,
        cacheReadInputTokens: 700,
        deduplicationKey: 'antigravity:field-session:response-fields',
      })
    })
  })

  it('migrates the v5 derived cache, reparses SQLite once, and stays idempotent', async () => {
    if (!isSqliteAvailable()) return

    await withTempAntigravityHome('metrora-antigravity-cache-v6-', async (tempHome) => {
      const cacheDir = join(tempHome, 'cache')
      const conversationsDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')
      await mkdir(conversationsDir, { recursive: true })
      await mkdir(cacheDir, { recursive: true })
      const fixture = JSON.parse(await readFile(
        new URL('../fixtures/antigravity-cli-current/gen-metadata.json', import.meta.url),
        'utf-8',
      )) as CurrentCliFixture
      const dbPath = join(conversationsDir, `${fixture.conversationId}.db`)
      createCurrentAntigravityCliDb(dbPath, fixture)
      const dbStat = await stat(dbPath)
      await writeFile(join(cacheDir, 'antigravity-results.json'), JSON.stringify({
        version: 5,
        cascades: {
          [fixture.conversationId]: {
            mtimeMs: dbStat.mtimeMs,
            sizeBytes: dbStat.size,
            calls: [{
              provider: 'antigravity', model: 'stale-model', inputTokens: 1, outputTokens: 1,
              cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cachedInputTokens: 0,
              reasoningTokens: 0, webSearchRequests: 0, costUSD: 0, tools: [], bashCommands: [],
              timestamp: '', speed: 'standard', deduplicationKey: 'antigravity:stale',
              userMessage: '', sessionId: fixture.conversationId,
            }],
          },
          orphanedCascade: {
            mtimeMs: 0,
            sizeBytes: 0,
            calls: [{
              provider: 'antigravity', model: 'gemini-3.6-flash', inputTokens: 2, outputTokens: 1,
              cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cachedInputTokens: 0,
              reasoningTokens: 0, webSearchRequests: 0, costUSD: 0, tools: [], bashCommands: [],
              timestamp: '2026-08-01T00:00:00.000Z', speed: 'standard',
              deduplicationKey: 'antigravity:orphanedCascade:response', userMessage: '',
              sessionId: 'orphanedCascade',
            }],
          },
        },
      }))

      resetAntigravityMemoryCacheForTests()
      const source = { path: dbPath, project: 'antigravity-ide', provider: 'antigravity' }
      const first = await collectAntigravityCalls(source)
      await flushAntigravityCache(new Set([fixture.conversationId]))
      const migrated = JSON.parse(await readFile(join(cacheDir, 'antigravity-results.json'), 'utf-8'))

      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({ inputTokens: 31281, model: 'gemini-3.1-pro-high' })
      expect(migrated).toMatchObject({
        version: 6,
        cascades: { [fixture.conversationId]: { parserVersion: 6 } },
      })
      expect(migrated.cascades.orphanedCascade).toBeUndefined()

      resetAntigravityMemoryCacheForTests()
      const second = await collectAntigravityCalls(source)
      expect(second).toEqual(first)
      resetAntigravityMemoryCacheForTests()
    })
  })

  it('stamps file mtime as fallback timestamp for SQLite-parsed calls', async () => {
    if (!isSqliteAvailable()) return

    await withTempAntigravityHome('metrora-antigravity-timestamp-', async (tempHome) => {
      const fixture = JSON.parse(await readFile(
        new URL('../fixtures/antigravity-cli-current/gen-metadata.json', import.meta.url),
        'utf-8',
      )) as CurrentCliFixture
      const conversationsDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')

      await mkdir(conversationsDir, { recursive: true })

      const dbPath = join(conversationsDir, `${fixture.conversationId}.db`)
      createCurrentAntigravityCliDb(dbPath, fixture)

      const beforeStat = await stat(dbPath)

      const parser = createAntigravityProvider().createSessionParser({
        path: dbPath,
        project: 'antigravity-ide',
        provider: 'antigravity',
      }, new Set())
      const calls: ParsedProviderCall[] = []
      for await (const call of parser.parse()) calls.push(call)

      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call.timestamp).not.toBe('')
        const callTime = new Date(call.timestamp).getTime()
        expect(Math.abs(callTime - beforeStat.mtimeMs)).toBeLessThan(5000)
      }
    })
  })

  it('decodes ChatStartMetadata.created_at and prefers it over the file mtime', async () => {
    if (!isSqliteAvailable()) return

    await withTempAntigravityHome('metrora-antigravity-createdat-', async (tempHome) => {
      // Encode a gen_metadata blob matching the real on-disk shape:
      //   GeneratorMetadata.chatModel(#1) {
      //     usage(#4) { input(#2), totalOutput(#3) }
      //     chatStartMetadata(#9) { created_at(#4): Timestamp { seconds(#1), nanos(#2) } }
      //   }
      const varint = (n: number): number[] => {
        const out: number[] = []
        let v = n
        while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128) }
        out.push(v)
        return out
      }
      const tag = (field: number, wire: number): number[] => varint(field * 8 + wire)
      const varintField = (field: number, n: number): number[] => [...tag(field, 0), ...varint(n)]
      const lenField = (field: number, bytes: number[]): number[] => [...tag(field, 2), ...varint(bytes.length), ...bytes]

      const seconds = 1783326234
      const nanos = 724675400
      const timestamp = [...varintField(1, seconds), ...varintField(2, nanos)]
      const chatStartMetadata = lenField(4, timestamp)
      const usage = lenField(4, [...varintField(2, 100), ...varintField(3, 50)])
      const chatModel = [...usage, ...lenField(9, chatStartMetadata)]
      const hex = Buffer.from(lenField(1, chatModel)).toString('hex')

      const conversationsDir = join(tempHome, '.gemini', 'antigravity-ide', 'conversations')
      await mkdir(conversationsDir, { recursive: true })
      const dbPath = join(conversationsDir, 'created-at-session.db')
      createCurrentAntigravityCliDb(dbPath, { conversationId: 'created-at-session', rows: [{ idx: 0, hex }] })

      // Pin the file mtime to a different day so a wrong fallback is obvious.
      const mtime = new Date('2026-01-01T00:00:00.000Z')
      await utimes(dbPath, mtime, mtime)

      const calls = await collectAntigravityCalls({ path: dbPath, project: 'antigravity-ide', provider: 'antigravity' })

      expect(calls.length).toBe(1)
      // The real created_at (July), not the January file mtime.
      expect(calls[0]!.timestamp).toBe('2026-07-06T08:23:54.724Z')
    })
  })

  it('classifies paths by their .gemini root, not by the profile directory name', () => {
    expect(antigravityAppDataDirFromSourcePath(
      '/Users/User/.gemini/antigravity-ide/conversations/abc.db',
    )).toBe('antigravity-ide')

    expect(antigravityAppDataDirFromSourcePath(
      '/Users/User/.gemini/antigravity-cli/conversations/abc.db',
    )).toBe('antigravity-cli')

    expect(antigravityAppDataDirFromSourcePath(
      '/Users/User/.gemini/antigravity/conversations/abc.db',
    )).toBe('antigravity')

    // A profile directory literally named "Antigravity IDE" must not override
    // the .gemini root: these are CLI and base-app paths, not IDE paths.
    expect(antigravityAppDataDirFromSourcePath(
      'C:\\Users\\Antigravity IDE\\.gemini\\antigravity-cli\\conversations\\abc.db',
    )).toBe('antigravity-cli')

    expect(antigravityAppDataDirFromSourcePath(
      'C:\\Users\\Antigravity IDE\\.gemini\\antigravity\\conversations\\abc.db',
    )).toBe('antigravity')
  })
})
