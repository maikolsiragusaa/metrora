import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let root = ''
let previousCacheDir: string | undefined
let previousGrokHome: string | undefined
let sessionCacheApi: typeof import('../src/session-cache.js')

const SESSION_ID = '019edf9c-0000-7000-8000-000000000101'

beforeEach(async () => {
  vi.resetModules()
  root = await mkdtemp(join(tmpdir(), 'metrora-grok-pipeline-'))
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  previousGrokHome = process.env['GROK_HOME']
  process.env['METRORA_CACHE_DIR'] = join(root, 'metrora-cache')
  process.env['GROK_HOME'] = join(root, 'grok')
  await writeGrokSession()
  sessionCacheApi = await import('../src/session-cache.js')
})

afterEach(async () => {
  const { clearSessionCache } = await import('../src/parser.js')
  clearSessionCache()
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  if (previousGrokHome === undefined) delete process.env['GROK_HOME']
  else process.env['GROK_HOME'] = previousGrokHome
  await rm(root, { recursive: true, force: true })
})

function usage(): Record<string, unknown> {
  return {
    inputTokens: 1000,
    outputTokens: 200,
    cachedReadTokens: 500,
    cacheCreationTokens: 100,
    reasoningTokens: 150,
    modelUsage: { 'grok-build': { inputTokens: 1000, outputTokens: 200 } },
  }
}

async function writeGrokSession(
  completedUsages: Array<{ promptId: string; usage: Record<string, unknown> }> = [
    { promptId: 'pipeline-prompt', usage: usage() },
  ],
): Promise<string> {
  const sessionDir = join(process.env['GROK_HOME']!, 'sessions', '%2Fworkspace', SESSION_ID)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'summary.json'), JSON.stringify({
    info: { id: SESSION_ID, cwd: '/workspace/grok-project' },
    created_at: '2026-08-17T10:00:00.000Z',
    updated_at: '2026-08-17T10:05:00.000Z',
    current_model_id: 'grok-build',
    session_summary: 'pipeline fixture',
  }))
  await writeFile(join(sessionDir, 'signals.json'), JSON.stringify({
    primaryModelId: 'grok-build',
    modelsUsed: ['grok-build'],
  }))
  const lines = [
    JSON.stringify({ params: { _meta: { totalTokens: 100, promptId: 'pipeline-prompt' }, update: { sessionUpdate: 'agent_message_chunk' } } }),
    JSON.stringify({ params: { _meta: { totalTokens: 120, promptId: 'pipeline-prompt' }, update: { sessionUpdate: 'agent_message_chunk' } } }),
    ...completedUsages.map(completed => JSON.stringify({ params: {
      update: { sessionUpdate: 'turn_completed', prompt_id: completed.promptId, usage: completed.usage },
    } })),
  ]
  const updatesPath = join(sessionDir, 'updates.jsonl')
  await writeFile(updatesPath, lines.join('\n') + '\n')
  return updatesPath
}

async function parseGrok() {
  const { parseAllSessions } = await import('../src/parser.js')
  return parseAllSessions(undefined, 'grok')
}

function firstCall(projects: Awaited<ReturnType<typeof parseGrok>>) {
  const call = projects[0]?.sessions[0]?.turns[0]?.assistantCalls[0]
  if (!call) throw new Error('Expected a Grok assistant call')
  return call
}

describe('Grok parser/session-cache pipeline', () => {
  it('preserves authoritative token semantics through cold and warm cache reloads', async () => {
    const cold = firstCall(await parseGrok())
    expect(cold).toMatchObject({
      reasoningSemantics: 'aggregate-output',
      cacheTokenEvidence: 'complete',
      isEstimated: false,
      usage: {
        inputTokens: 400,
        cacheReadInputTokens: 500,
        cacheCreationInputTokens: 100,
        outputTokens: 200,
        reasoningTokens: 150,
      },
    })

    const { clearSessionCache } = await import('../src/parser.js')
    clearSessionCache()
    const warm = firstCall(await parseGrok())
    expect(warm).toEqual(cold)
    expect(warm.isEstimated).toBe(false)

    const cache = await sessionCacheApi.loadCache()
    const updatesPath = join(process.env['GROK_HOME']!, 'sessions', '%2Fworkspace', SESSION_ID, 'updates.jsonl')
    const cachedCall = cache.providers.grok?.files[updatesPath]?.turns[0]?.calls[0]
    expect(cachedCall).toMatchObject({
      reasoningSemantics: 'aggregate-output',
      cacheTokenEvidence: 'complete',
      isEstimated: false,
      usage: { outputTokens: 200, reasoningTokens: 150 },
    })
  })

  it('reparses an unchanged source when the Grok parser authority advances', async () => {
    const currentAuthority = sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok!
    const updatesPath = join(process.env['GROK_HOME']!, 'sessions', '%2Fworkspace', SESSION_ID, 'updates.jsonl')
    firstCall(await parseGrok())

    const oldAuthority = 'estimated-cost-v1'
    sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok = oldAuthority
    try {
      const cache = await sessionCacheApi.loadCache()
      const section = cache.providers.grok
      if (!section) throw new Error('Expected Grok cache section')
      section.envFingerprint = sessionCacheApi.computeEnvFingerprint('grok')
      const cachedCall = section.files[updatesPath]?.turns[0]?.calls[0]
      if (!cachedCall) throw new Error('Expected cached Grok call')
      cachedCall.isEstimated = true
      delete cachedCall.reasoningSemantics
      delete cachedCall.cacheTokenEvidence
      cachedCall.usage.inputTokens = 999
      await sessionCacheApi.saveCache(cache)

      const { clearSessionCache } = await import('../src/parser.js')
      sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok = currentAuthority
      clearSessionCache()
      const reparsed = firstCall(await parseGrok())
      expect(reparsed).toMatchObject({
        reasoningSemantics: 'aggregate-output',
        cacheTokenEvidence: 'complete',
        usage: { inputTokens: 400, outputTokens: 200, reasoningTokens: 150 },
      })
    } finally {
      sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok = currentAuthority
    }
  })

  it('preserves unavailable reasoning semantics through cold and warm cache reloads', async () => {
    await writeGrokSession([{
      promptId: 'unavailable-prompt',
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cachedReadTokens: 500,
        cacheCreationTokens: 100,
        modelUsage: { 'grok-build': { inputTokens: 1000, outputTokens: 200 } },
      },
    }])
    const cold = firstCall(await parseGrok())
    expect(cold).toMatchObject({ usage: { outputTokens: 200, reasoningTokens: 0 }, reasoningSemantics: 'unavailable' })

    const { clearSessionCache } = await import('../src/parser.js')
    clearSessionCache()
    const warm = firstCall(await parseGrok())
    expect(warm).toEqual(cold)

    const cache = await sessionCacheApi.loadCache()
    const updatesPath = join(process.env['GROK_HOME']!, 'sessions', '%2Fworkspace', SESSION_ID, 'updates.jsonl')
    expect(cache.providers.grok?.files[updatesPath]?.turns[0]?.calls[0]).toMatchObject({ reasoningSemantics: 'unavailable', usage: { reasoningTokens: 0 } })
  })

  it('preserves mixed reasoning semantics and output totals through cold and warm cache reloads', async () => {
    await writeGrokSession([
      {
        promptId: 'observed-prompt',
        usage: { inputTokens: 1000, outputTokens: 200, cachedReadTokens: 500, cacheCreationTokens: 100, reasoningTokens: 100 },
      },
      {
        promptId: 'unobserved-prompt',
        usage: { inputTokens: 1200, outputTokens: 300, cachedReadTokens: 600, cacheCreationTokens: 100 },
      },
    ])
    const cold = firstCall(await parseGrok())
    expect(cold).toMatchObject({ usage: { outputTokens: 500, reasoningTokens: 100 }, reasoningSemantics: 'mixed' })

    const { clearSessionCache } = await import('../src/parser.js')
    clearSessionCache()
    const warm = firstCall(await parseGrok())
    expect(warm).toEqual(cold)
  })
})
