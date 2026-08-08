import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import { enqueueMeasurementEventV1 } from './measurement-outbox.js'

const roots: string[] = []
const PRODUCTION_KEY = 'a'.repeat(64)

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-production-receipt-'))
  roots.push(value)
  return value
}

function event(input: {
  id: string
  adapterVersion: string
  outputTokens?: number
}): UsageMeasurementEventV1 {
  return {
    specversion: '1.0',
    id: input.id,
    source: 'urn:metrora:endpoint:ep_test',
    type: USAGE_MEASUREMENT_EVENT_TYPE,
    time: '2026-08-01T14:00:00.000Z',
    subject: 'workspace/ws_test/endpoint/ep_test',
    datacontenttype: 'application/json',
    dataschema: USAGE_MEASUREMENT_DATA_SCHEMA_URI,
    data: {
      version: 1,
      workspaceId: 'ws_test',
      endpointId: 'ep_test',
      tool: { name: 'Codex', version: '1.0.0' },
      collector: {
        adapterId: 'codex-rollout-token-count-v1',
        adapterVersion: input.adapterVersion,
        sourceKind: 'codex-rollout-jsonl-token-count',
        sourceFingerprintSha256: '1'.repeat(64),
      },
      genAi: {
        operationName: 'chat',
        providerName: 'openai',
        responseModel: 'gpt-5.6-luna',
      },
      usage: {
        calls: 1,
        inputTokens: 100,
        outputTokens: input.outputTokens ?? 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
      },
      cost: {
        kind: 'estimated',
        amountMicrosUsd: 123_456,
        method: 'token-pricing',
      },
      reasoning: { level: 'high', source: 'explicit' },
      quality: {
        tokenCounts: 'measured',
        modelIdentity: 'normalized',
        sessionIdentity: 'unknown',
      },
      privacy: {
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        patchesIncluded: false,
        secretsIncluded: false,
        localPathsIncluded: false,
      },
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('private measurement production receipt semantics', () => {
  it('ignores rotating event IDs and Metrora release versions but binds measurement facts', async () => {
    const dataDir = await root()
    const first = await enqueueMeasurementEventV1(event({
      id: 'evt_before_rotation',
      adapterVersion: '0.9.19',
    }), {
      dataDir,
      productionKeySha256: PRODUCTION_KEY,
    })
    expect(first.status).toBe('enqueued')

    const afterUpgrade = await enqueueMeasurementEventV1(event({
      id: 'evt_after_rotation',
      adapterVersion: '0.9.20',
    }), {
      dataDir,
      productionKeySha256: PRODUCTION_KEY,
    })
    expect(afterUpgrade).toEqual({ status: 'duplicate', record: first.record })

    await expect(enqueueMeasurementEventV1(event({
      id: 'evt_changed_measurement',
      adapterVersion: '0.9.20',
      outputTokens: 21,
    }), {
      dataDir,
      productionKeySha256: PRODUCTION_KEY,
    })).rejects.toThrow(/production key collision/)
  })
})
