import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// End-to-end coverage for the unified store: the other cases drive the provider
// object directly, so only this one proves that a real Vibe Desktop tree reaches
// discovery, parsing, cost estimation and the session cache through
// parseAllSessions. It follows the module-reset pattern of
// tests/provider-turn-grouping.test.ts, which is what makes the parser pick up
// VIBE_HOME from the environment instead of ~/.vibe.

let home: string
let cacheDir: string
let vibeHome: string
let clearParserCache: (() => void) | undefined

const PRICED_MODEL = 'mistral-medium-3.5'

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'metrora-vibe-e2e-home-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'metrora-vibe-e2e-cache-'))
  vibeHome = await mkdtemp(join(tmpdir(), 'metrora-vibe-e2e-vibe-'))
  process.env['HOME'] = home
  process.env['USERPROFILE'] = home
  process.env['HOMEPATH'] = home
  process.env['HOMEDRIVE'] = ''
  process.env['METRORA_CACHE_DIR'] = cacheDir
  process.env['VIBE_HOME'] = vibeHome
})

afterEach(async () => {
  clearParserCache?.()
  clearParserCache = undefined
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
  await rm(vibeHome, { recursive: true, force: true })
})

async function loadParser() {
  vi.resetModules()
  const parser = await import('../../src/parser.js')
  clearParserCache = parser.clearSessionCache
  return parser.parseAllSessions
}

function journalRecords(parts: Array<Record<string, unknown>>) {
  const usage = {
    input_tokens: 1000,
    output_tokens: 200,
    cached_input_tokens: 400,
    cache_write_tokens: 100,
    reasoning_tokens: 50,
    total_tokens: 1200,
  }
  return [
    {
      type: 'command_reserved',
      payload: {
        method: 'turn/start',
        params: { entries: [{ role: 'user', content: [{ type: 'text', text: 'measure my desktop usage' }] }] },
      },
    },
    {
      type: 'action_result',
      payload: {
        action_id: 'action-e2e',
        state: 'succeeded',
        result: {
          type: 'completion_succeeded',
          result: { finish_reason: 'tool_call', parts, usage },
        },
      },
    },
  ]
}

describe('mistral-vibe provider - unified store end to end', () => {
  it('reports unified journal usage through parseAllSessions', async () => {
    const sessionDir = join(vibeHome, 'logs', 'session', 'unified', 'desktop-session')
    await mkdir(join(sessionDir, 'journal'), { recursive: true })
    await writeFile(join(sessionDir, 'meta.json'), JSON.stringify({
      session_id: 'desktop-session',
      start_time: '2026-11-21T15:28:15.825000+00:00',
      end_time: '2026-11-21T22:55:35.027000+00:00',
      environment: { working_directory: 'C:/Users/test/metrora-report' },
      config: { active_model: PRICED_MODEL, model_name: PRICED_MODEL },
      title: 'measure desktop sessions',
    }, null, 2))
    await writeFile(
      join(sessionDir, 'journal', '0000000000010000.jsonl'),
      journalRecords([{ type: 'tool_call', name: 'bash', arguments_json: JSON.stringify({ command: 'git status' }) }])
        .map(record => JSON.stringify(record)).join('\n') + '\n',
    )

    const parseAllSessions = await loadParser()
    const projects = await parseAllSessions(undefined, 'mistral-vibe')
    const calls = projects
      .flatMap(project => project.sessions)
      .flatMap(session => session.turns)
      .flatMap(turn => turn.assistantCalls)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('mistral-vibe')
    expect(call.sessionId).toBe('desktop-session')
    expect(call.model).toBe(PRICED_MODEL)
    // input_tokens is inclusive of the cached subset on this store.
    expect(call.inputTokens).toBe(600)
    expect(call.cacheReadInputTokens).toBe(400)
    expect(call.cacheCreationInputTokens).toBe(100)
    expect(call.outputTokens).toBe(200)
    expect(call.tools).toEqual(['Bash'])
    expect(call.cacheTokenEvidence).toBe('complete')
    expect(call.costIsEstimated).toBe(true)
    expect(call.costUSD).toBeGreaterThan(0)
    expect(call.deduplicationKey).toBe('mistral-vibe:desktop-session:unified:action-e2e')
  })
})
