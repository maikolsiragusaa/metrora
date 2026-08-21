import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sessionMeta(): string {
  return JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-08-01T10:00:00.000Z',
    payload: {
      session_id: 'codex-cache-model-session',
      cwd: '/tmp/codex-cache-model',
      originator: 'codex_cli_rs',
      base_instructions: {
        provenance: { type: 'model', model: 'WRONG_MODEL' },
        instruction_body: 'x'.repeat(40_000),
      },
    },
  })
}

function rollout(): string[] {
  return [
    sessionMeta(),
    JSON.stringify({
      type: 'turn_context',
      timestamp: '2026-08-01T10:00:01.000Z',
      payload: { model: 'RIGHT_MODEL' },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-01T10:00:02.000Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 4,
            total_tokens: 134,
          },
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 4,
            total_tokens: 134,
          },
        },
      },
    }),
  ]
}

function firstCall(projects: unknown[]): Record<string, any> {
  const call = (projects as any[])
    .flatMap(project => project.sessions ?? [])
    .flatMap(session => session.turns ?? [])
    .flatMap(turn => turn.assistantCalls ?? [])[0]
  if (!call) throw new Error('Expected one Codex call')
  return call
}

describe('Codex session_meta model cache authorities', () => {
  it('rejects a v11 Codex result cache and reparses the unchanged Buffer-path source', async () => {
    vi.resetModules()
    const root = await mkdtemp(join(tmpdir(), 'metrora-codex-result-cache-v12-'))
    roots.push(root)
    const cacheDir = join(root, 'metrora-cache')
    const codexHome = join(root, 'codex')
    const sessionDir = join(codexHome, 'sessions', '2026', '08', '01')
    await mkdir(sessionDir, { recursive: true })
    await mkdir(cacheDir, { recursive: true })
    process.env['CODEX_HOME'] = codexHome
    process.env['METRORA_CACHE_DIR'] = cacheDir
    const sourcePath = join(sessionDir, 'rollout-cache-model.jsonl')
    await writeFile(sourcePath, `${rollout().join('\n')}\n`, 'utf8')

    const { createCodexProvider } = await import('../src/providers/codex.js')
    const { flushCodexCache, readCachedCodexResults } = await import('../src/codex-cache.js')
    const sourceFingerprint = await stat(sourcePath)
    await writeFile(join(cacheDir, 'codex-results.json'), JSON.stringify({
      version: 11,
      files: {
        [sourcePath]: {
          mtimeMs: sourceFingerprint.mtimeMs,
          sizeBytes: sourceFingerprint.size,
          project: 'codex-cache-model',
          calls: [{
            provider: 'codex',
            model: 'WRONG_MODEL',
            inputTokens: 100,
            outputTokens: 30,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 20,
            cachedInputTokens: 20,
            reasoningTokens: 4,
            webSearchRequests: 0,
            costUSD: 0,
            tools: [],
            bashCommands: [],
            timestamp: '2026-08-01T10:00:02.000Z',
            speed: 'standard',
            deduplicationKey: 'codex:stale-result-cache',
            sessionId: 'codex-cache-model-session',
          }],
        },
      },
    }), 'utf8')

    await expect(readCachedCodexResults(sourcePath)).resolves.toBeNull()
    const provider = createCodexProvider(codexHome)
    const parsed: any[] = []
    for await (const call of provider.createSessionParser({ path: sourcePath, project: 'codex-cache-model', provider: 'codex' }, new Set()).parse()) parsed.push(call)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.model).toBe('RIGHT_MODEL')
    await flushCodexCache()

    const persisted = JSON.parse(await readFile(join(cacheDir, 'codex-results.json'), 'utf8'))
    expect(persisted.version).toBe(12)
    await expect(readCachedCodexResults(sourcePath)).resolves.toMatchObject([{ model: 'RIGHT_MODEL' }])
  })

  it('invalidates the session cache authority once, then stays warm without rereading Codex sources', async () => {
    vi.resetModules()
    const root = await mkdtemp(join(tmpdir(), 'metrora-codex-session-cache-model-'))
    roots.push(root)
    const cacheDir = join(root, 'metrora-cache')
    const codexHome = join(root, 'codex')
    const sessionDir = join(codexHome, 'sessions', '2026', '08', '01')
    await mkdir(sessionDir, { recursive: true })
    process.env['CODEX_HOME'] = codexHome
    process.env['METRORA_CACHE_DIR'] = cacheDir
    const sourcePath = join(sessionDir, 'rollout-session-cache-model.jsonl')
    await writeFile(sourcePath, `${rollout().join('\n')}\n`, 'utf8')

    const fsUtils = await import('../src/fs-utils.js')
    const parser = await import('../src/parser.js')
    const sessionCache = await import('../src/session-cache.js')

    const initial = await parser.parseAllSessions(undefined, 'codex')
    expect(firstCall(initial).model).toBe('RIGHT_MODEL')

    const cachePath = sessionCache.sessionCachePath()
    const cache = await sessionCache.loadCache()
    const codexSection = cache.providers.codex
    if (!codexSection) throw new Error('Expected Codex session-cache section')
    const cachedFile = codexSection.files[sourcePath]
    if (!cachedFile) throw new Error('Expected Codex source in session cache')
    cachedFile.turns[0]!.calls[0]!.model = 'WRONG_MODEL'
    const currentAuthority = sessionCache.PROVIDER_PARSE_VERSIONS.codex!
    const priorAuthority = currentAuthority.replace('-session-meta-model-v1', '')
    codexSection.envFingerprint = createHash('sha256')
      .update(`CODEX_HOME=${codexHome}\0parser=${priorAuthority}`)
      .digest('hex')
      .slice(0, 16)
    await sessionCache.saveCache(cache)

    const resultCachePath = join(cacheDir, 'codex-results.json')
    const resultCache = JSON.parse(await readFile(resultCachePath, 'utf8'))
    resultCache.version = 11
    for (const file of Object.values(resultCache.files) as any[]) {
      for (const call of file.calls ?? []) call.model = 'WRONG_MODEL'
    }
    await writeFile(resultCachePath, JSON.stringify(resultCache), 'utf8')

    // A fresh module graph simulates a new process, clearing the in-memory
    // Codex result cache as well as the parser's short-lived result cache.
    vi.resetModules()
    const fsUtilsAfterRestart = await import('../src/fs-utils.js')
    const parserAfterRestart = await import('../src/parser.js')
    const sessionCacheAfterRestart = await import('../src/session-cache.js')
    const reparsed = await parserAfterRestart.parseAllSessions(undefined, 'codex')
    expect(firstCall(reparsed).model).toBe('RIGHT_MODEL')

    const repaired = await sessionCacheAfterRestart.loadCache()
    expect(repaired.providers.codex?.envFingerprint).toBe(sessionCacheAfterRestart.computeEnvFingerprint('codex'))
    expect(repaired.providers.codex?.files[sourcePath]?.turns[0]?.calls[0]?.model).toBe('RIGHT_MODEL')

    const readSpy = vi.spyOn(fsUtilsAfterRestart, 'readSessionLines')
    parserAfterRestart.clearSessionCache()
    const warm = await parserAfterRestart.parseAllSessions(undefined, 'codex')
    expect(firstCall(warm).model).toBe('RIGHT_MODEL')
    expect(readSpy).not.toHaveBeenCalled()
    readSpy.mockRestore()

    // Keep the old module reference used during setup live only for the
    // assertions above; the test never touches a real Metrora cache path.
    expect(fsUtils).toBeDefined()
    expect(cachePath).toContain(cacheDir)
  })
})
