import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseApiCall, parseJsonlLine } from '../../parser.js'
import { createCodexProvider } from '../../providers/codex.js'
import type { ParsedProviderCall, SessionSource } from '../../providers/types.js'
import type { ParsedApiCall } from '../../types.js'
import {
  CLAUDE_JSONL_PROFILE_V1,
  CODEX_CONTENT_FALLBACK_PROFILE_V1,
  CODEX_TOKEN_COUNT_PROFILE_V1,
} from './collector-provenance.js'
import { resolveMeasurementEvidenceV1 } from './provenance-mapper.js'

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'contracts')
const temporaryRoots: string[] = []

async function fixtureLines(name: string): Promise<string[]> {
  return (await readFile(join(FIXTURES, name), 'utf-8'))
    .split(/\r?\n/)
    .filter(Boolean)
}

async function claudeFixtureCall(): Promise<ParsedApiCall> {
  const entries = (await fixtureLines('claude-jsonl-usage-v1.jsonl'))
    .map(line => parseJsonlLine(line))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const assistant = entries.find(entry => entry.type === 'assistant')
  if (!assistant) throw new Error('Claude fixture has no assistant entry')
  const call = parseApiCall(assistant)
  if (!call) throw new Error('Claude fixture did not produce an API call')
  return call
}

function normalizeProviderCall(call: ParsedProviderCall): ParsedApiCall {
  const tools = call.tools ?? []
  return {
    provider: call.provider,
    model: call.model,
    ...(call.reasoningLevel !== undefined ? { reasoningLevel: call.reasoningLevel } : {}),
    ...(call.reasoningLevelSource !== undefined ? { reasoningLevelSource: call.reasoningLevelSource } : {}),
    usage: {
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cacheCreationInputTokens: call.cacheCreationInputTokens,
      cacheReadInputTokens: call.cacheReadInputTokens,
      cachedInputTokens: call.cachedInputTokens,
      reasoningTokens: call.reasoningTokens,
      webSearchRequests: call.webSearchRequests,
    },
    costUSD: call.costUSD,
    tools,
    mcpTools: tools.filter(tool => tool.startsWith('mcp__')),
    skills: call.skills ?? [],
    subagentTypes: call.subagentTypes ?? [],
    hasAgentSpawn: tools.includes('Agent'),
    hasPlanMode: tools.includes('EnterPlanMode'),
    speed: call.speed,
    timestamp: call.timestamp,
    bashCommands: call.bashCommands,
    deduplicationKey: call.deduplicationKey,
    ...(call.costIsEstimated !== undefined ? { isEstimated: call.costIsEstimated } : {}),
  }
}

async function codexFixtureCall(name: string): Promise<ParsedApiCall> {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'qovrion-provenance-'))
  temporaryRoots.push(cacheRoot)
  process.env['CODEBURN_CACHE_DIR'] = cacheRoot

  const source: SessionSource = {
    path: join(FIXTURES, name),
    project: 'qovrion-fixture',
    provider: 'codex',
  }
  const parser = createCodexProvider().createSessionParser(source, new Set())
  const calls: ParsedProviderCall[] = []
  for await (const call of parser.parse()) calls.push(call)
  expect(calls).toHaveLength(1)
  return normalizeProviderCall(calls[0]!)
}

afterEach(async () => {
  delete process.env['CODEBURN_CACHE_DIR']
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe.sequential('collector fixture parity and evidence resolution v1', () => {
  it('keeps Claude JSONL facts aligned with its reviewed profile', async () => {
    const call = await claudeFixtureCall()

    expect(call).toMatchObject({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 30,
        reasoningTokens: 0,
      },
      cacheCreationOneHourTokens: 3,
    })

    const evidence = resolveMeasurementEvidenceV1(call, { sessionIdExported: true })
    expect(evidence?.profile).toBe(CLAUDE_JSONL_PROFILE_V1)
    expect(evidence?.quality).toEqual({
      tokenCounts: 'derived',
      modelIdentity: 'normalized',
      sessionIdentity: 'exact',
    })
    expect(evidence?.costEvidence).toEqual({ kind: 'estimated', method: 'token-pricing' })
  })

  it('keeps Codex token_count facts measured after cached-input normalization', async () => {
    const call = await codexFixtureCall('codex-token-count-v1.jsonl')

    expect(call).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.5',
      reasoningLevel: 'high',
      reasoningLevelSource: 'explicit',
      usage: {
        inputTokens: 60,
        outputTokens: 20,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 40,
        reasoningTokens: 5,
      },
    })
    expect(call.isEstimated).not.toBe(true)

    const evidence = resolveMeasurementEvidenceV1(call, { sessionIdExported: true })
    expect(evidence?.profile).toBe(CODEX_TOKEN_COUNT_PROFILE_V1)
    expect(evidence?.quality).toEqual({
      tokenCounts: 'measured',
      modelIdentity: 'normalized',
      sessionIdentity: 'exact',
    })
    expect(evidence?.costEvidence).toEqual({ kind: 'estimated', method: 'token-pricing' })
  })

  it('keeps Codex content fallback explicitly estimated', async () => {
    const call = await codexFixtureCall('codex-content-fallback-v1.jsonl')

    expect(call.provider).toBe('codex')
    expect(call.model).toBe('gpt-5.5')
    expect(call.isEstimated).toBe(true)
    expect(call.usage.inputTokens).toBeGreaterThan(0)
    expect(call.usage.outputTokens).toBeGreaterThan(0)
    expect(call.usage.cacheReadInputTokens).toBe(0)
    expect(call.usage.reasoningTokens).toBe(0)

    const evidence = resolveMeasurementEvidenceV1(call, { sessionIdExported: true })
    expect(evidence?.profile).toBe(CODEX_CONTENT_FALLBACK_PROFILE_V1)
    expect(evidence?.quality).toEqual({
      tokenCounts: 'estimated',
      modelIdentity: 'normalized',
      sessionIdentity: 'exact',
    })
    expect(evidence?.costEvidence).toEqual({ kind: 'estimated', method: 'content-length' })
  })

  it('degrades cost to unavailable when pricing coverage is absent or stale', async () => {
    const call = await codexFixtureCall('codex-token-count-v1.jsonl')

    const unpriced = resolveMeasurementEvidenceV1(
      { ...call, model: 'qovrion-unpriced-fixture-model', costUSD: 0 },
      { sessionIdExported: true },
    )
    expect(unpriced?.costEvidence).toEqual({ kind: 'unavailable' })

    const stale = resolveMeasurementEvidenceV1(
      { ...call, costUSD: call.costUSD + 1 },
      { sessionIdExported: true },
    )
    expect(stale?.costEvidence).toEqual({ kind: 'unavailable' })
  })

  it('fails closed for unreviewed collectors and unsupported attribution', async () => {
    const codexCall = await codexFixtureCall('codex-token-count-v1.jsonl')
    expect(resolveMeasurementEvidenceV1(
      { ...codexCall, provider: 'zed' },
      { sessionIdExported: true },
    )).toBeUndefined()

    const claudeCall = await claudeFixtureCall()
    expect(resolveMeasurementEvidenceV1(
      { ...claudeCall, reasoningLevel: 'high', reasoningLevelSource: 'explicit' },
      { sessionIdExported: true },
    )).toBeUndefined()
  })

  it('does not claim session identity when the session id is withheld', async () => {
    const call = await codexFixtureCall('codex-token-count-v1.jsonl')
    const evidence = resolveMeasurementEvidenceV1(call, { sessionIdExported: false })
    expect(evidence?.quality.sessionIdentity).toBe('unknown')
  })

  it('rejects malformed normalized token facts before producing evidence', async () => {
    const call = await codexFixtureCall('codex-token-count-v1.jsonl')
    expect(() => resolveMeasurementEvidenceV1(
      {
        ...call,
        usage: { ...call.usage, inputTokens: -1 },
      },
      { sessionIdExported: true },
    )).toThrow(/non-negative safe integer/)
  })
})
