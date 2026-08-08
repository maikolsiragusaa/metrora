import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'

import { clearSessionCache, parseAllSessions } from '../src/parser.js'
import { sessionCachePath } from '../src/session-cache.js'

const testRoot = vi.hoisted(() => {
  const separator = process.platform === 'win32' ? '\\' : '/'
  const base = process.env['TMPDIR'] ?? process.env['TMP'] ?? process.env['TEMP'] ?? '.'
  const root = `${base}${base.endsWith(separator) ? '' : separator}codex-kimi-context-${process.pid}-${Date.now()}`
  const home = `${root}${separator}home`
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
  process.env['CODEX_HOME'] = `${root}${separator}codex`
  return root
})

const CODEX_HOME = join(testRoot, 'codex')
const CACHE_DIR = join(testRoot, 'cache')
const PREVIOUS_PARSE_VERSION = 'mcp-attribution-v5-est-cost-active-timing-mcp-wait-rich-capture-v1-cross-provider-pr-v1-reasoning-attribution-v1'

function previousFingerprint(): string {
  return createHash('sha256')
    .update(`CODEX_HOME=${CODEX_HOME}\0parser=${PREVIOUS_PARSE_VERSION}`)
    .digest('hex')
    .slice(0, 16)
}

function allCalls(projects: Awaited<ReturnType<typeof parseAllSessions>>) {
  return projects
    .flatMap(project => project.sessions)
    .flatMap(session => session.turns)
    .flatMap(turn => turn.assistantCalls)
}

async function seedRollout(): Promise<void> {
  const dir = join(CODEX_HOME, 'sessions', '2026', '08', '05')
  await mkdir(dir, { recursive: true })
  const lines = [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-08-05T10:00:00Z', payload: { session_id: 'sess-kimi-tag', model: 'kimi/k3[1m]', model_provider: 'kimi', cwd: '/Users/test/kimi', originator: 'codex_cli_rs' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-08-05T10:00:10Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'price the raw Kimi model' }] } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-08-05T10:01:00Z', payload: { type: 'token_count', info: { model: 'kimi/k3[1m]', last_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0, total_tokens: 1100 }, total_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0, total_tokens: 1100 } } } }),
  ]
  await writeFile(join(dir, 'rollout-kimi-tag.jsonl'), lines.join('\n') + '\n')
}

beforeEach(async () => {
  process.env['HOME'] = join(testRoot, 'home')
  process.env['USERPROFILE'] = join(testRoot, 'home')
  process.env['CODEX_HOME'] = CODEX_HOME
  process.env['METRORA_CACHE_DIR'] = CACHE_DIR
  clearSessionCache()
  await rm(testRoot, { recursive: true, force: true })
  await seedRollout()
})

afterAll(async () => {
  clearSessionCache()
  await rm(testRoot, { recursive: true, force: true })
})

describe('Codex Kimi context-tag cache reconciliation', () => {
  it('preserves the raw model while rejecting stale zero-cost caches', async () => {
    const freshCalls = allCalls(await parseAllSessions(undefined, 'codex'))
    expect(freshCalls).toHaveLength(1)
    expect(freshCalls[0]!.model).toBe('kimi/k3[1m]')
    expect(freshCalls[0]!.costUSD).toBeGreaterThan(0)

    const cachePath = sessionCachePath()
    const cache = JSON.parse(await readFile(cachePath, 'utf8'))
    cache.providers.codex.envFingerprint = previousFingerprint()
    for (const file of Object.values(cache.providers.codex.files) as any[]) {
      for (const turn of file.turns ?? []) {
        for (const call of turn.calls ?? []) {
          call.costUSD = 0
          call.costAssignment = { version: 1, kind: 'unavailable', reason: 'no-price-record' }
        }
      }
    }
    await writeFile(cachePath, JSON.stringify(cache))

    const codexCachePath = join(CACHE_DIR, 'codex-results.json')
    const codexCache = JSON.parse(await readFile(codexCachePath, 'utf8'))
    codexCache.version = 9
    for (const file of Object.values(codexCache.files) as any[]) {
      for (const call of file.calls ?? []) call.costUSD = 0
    }
    await writeFile(codexCachePath, JSON.stringify(codexCache))

    clearSessionCache()
    const reparsedCalls = allCalls(await parseAllSessions(undefined, 'codex'))
    expect(reparsedCalls).toHaveLength(1)
    expect(reparsedCalls[0]!.model).toBe('kimi/k3[1m]')
    expect(reparsedCalls[0]!.costUSD).toBeGreaterThan(0)
    expect(reparsedCalls[0]!.costAssignment?.kind).not.toBe('unavailable')
  })
})
