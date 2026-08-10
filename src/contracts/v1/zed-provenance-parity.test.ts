import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerCallToTurn } from '../../parser.js'
import { createZedProvider } from '../../providers/zed.js'
import { isSqliteAvailable } from '../../sqlite.js'
import type { ParsedApiCall } from '../../types.js'
import {
  ZED_CUMULATIVE_REMAINDER_PROFILE_V1,
  ZED_REQUEST_USAGE_PROFILE_V1,
} from './collector-provenance.js'
import { resolveMeasurementEvidenceV1 } from './provenance-mapper.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function createThreadsDb(path: string, modelProvider?: unknown): void {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      summary TEXT,
      updated_at TEXT,
      data_type TEXT,
      data BLOB
    )
  `)
  const payload = JSON.stringify({
    model: {
      ...(modelProvider !== undefined ? { provider: modelProvider } : {}),
      model: 'claude-sonnet-4-6',
    },
    request_token_usage: {
      request_1: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 30,
      },
    },
    cumulative_token_usage: {
      input_tokens: 150,
      output_tokens: 30,
      cache_creation_input_tokens: 15,
      cache_read_input_tokens: 40,
    },
  })
  db.prepare('INSERT INTO threads (id, summary, updated_at, data_type, data) VALUES (?, ?, ?, ?, ?)')
    .run('thread-1', 'Zed fixture', '2026-07-31T18:00:00.000Z', 'json', Buffer.from(payload))
  db.close()
}

async function parsedCalls(modelProvider?: unknown): Promise<ParsedApiCall[]> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-zed-provenance-'))
  temporaryRoots.push(root)
  const dbPath = join(root, 'threads.db')
  createThreadsDb(dbPath, modelProvider)

  const provider = createZedProvider(dbPath)
  const [source] = await provider.discoverSessions()
  if (!source) throw new Error('Zed fixture database was not discovered')

  const calls: ParsedApiCall[] = []
  for await (const call of provider.createSessionParser(source, new Set()).parse()) {
    calls.push(providerCallToTurn(call).assistantCalls[0]!)
  }
  return calls
}

const sqliteDescribe = isSqliteAvailable() ? describe : describe.skip

sqliteDescribe('Zed fixture parity and evidence resolution v1', () => {
  it('keeps request counters measured and cumulative remainder derived', async () => {
    const calls = await parsedCalls('Anthropic')
    expect(calls).toHaveLength(2)

    const request = calls.find(call => call.deduplicationKey.endsWith(':request_1'))
    const remainder = calls.find(call => call.deduplicationKey.endsWith(':cumulative-remainder'))
    expect(request).toBeDefined()
    expect(remainder).toBeDefined()

    expect(request).toMatchObject({
      provider: 'zed',
      modelProvider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 30,
        reasoningTokens: 0,
      },
      costAssignment: {
        version: 1,
        kind: 'legacy-frozen',
        reason: 'inherited-token-pricing',
      },
    })
    expect(remainder).toMatchObject({
      provider: 'zed',
      modelProvider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage: {
        inputTokens: 50,
        outputTokens: 10,
        cacheCreationInputTokens: 5,
        cacheReadInputTokens: 10,
        reasoningTokens: 0,
      },
      costAssignment: {
        version: 1,
        kind: 'legacy-frozen',
        reason: 'inherited-token-pricing',
      },
    })

    const requestEvidence = resolveMeasurementEvidenceV1(request!, { sessionId: 'thread-1' })
    expect(requestEvidence?.profile).toBe(ZED_REQUEST_USAGE_PROFILE_V1)
    expect(requestEvidence?.quality).toEqual({
      tokenCounts: 'measured',
      modelIdentity: 'exact',
      sessionIdentity: 'exact',
    })
    expect(requestEvidence?.costEvidence).toEqual({ kind: 'estimated', method: 'other' })

    const remainderEvidence = resolveMeasurementEvidenceV1(remainder!, { sessionId: 'thread-1' })
    expect(remainderEvidence?.profile).toBe(ZED_CUMULATIVE_REMAINDER_PROFILE_V1)
    expect(remainderEvidence?.quality).toEqual({
      tokenCounts: 'derived',
      modelIdentity: 'exact',
      sessionIdentity: 'exact',
    })
    expect(remainderEvidence?.costEvidence).toEqual({ kind: 'estimated', method: 'other' })
  })

  it('withholds both paths when Zed did not record the underlying model provider', async () => {
    const calls = await parsedCalls()
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.modelProvider).toBeUndefined()
      expect(resolveMeasurementEvidenceV1(call, { sessionId: 'thread-1' })).toBeUndefined()
    }
  })
})