import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import {
  MeasurementProductionRecoveryIntegrityError,
  reconcileMeasurementProductionReceiptsV1,
} from './measurement-production-recovery.js'
import {
  enqueueMeasurementEventV1,
  scanMeasurementOutboxV1,
} from './measurement-outbox.js'

const roots: string[] = []
const PRODUCTION_KEY = 'a'.repeat(64)

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-production-recovery-'))
  roots.push(value)
  return value
}

function event(): UsageMeasurementEventV1 {
  return {
    specversion: '1.0',
    id: 'evt_interrupted_publication',
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
        adapterVersion: '0.9.19',
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
        outputTokens: 20,
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

describe.sequential('measurement production receipt recovery', () => {
  it('republishes the original immutable event without rescanning source history', async () => {
    const dataDir = await root()
    const produced = await enqueueMeasurementEventV1(event(), {
      dataDir,
      productionKeySha256: PRODUCTION_KEY,
    })
    expect(produced.status).toBe('enqueued')

    const eventDir = join(dataDir, 'outbox', 'v1', 'events')
    const [eventFile] = await readdir(eventDir)
    expect(eventFile).toBeDefined()
    await unlink(join(eventDir, eventFile!))
    expect((await scanMeasurementOutboxV1({ dataDir })).pending).toEqual([])

    await expect(reconcileMeasurementProductionReceiptsV1({ dataDir })).resolves.toEqual({
      kind: 'metrora.measurement-production-recovery-summary',
      version: 1,
      receiptCount: 1,
      repairedEventCount: 1,
    })

    const after = await scanMeasurementOutboxV1({ dataDir })
    expect(after.pending).toHaveLength(1)
    expect(after.pending[0]).toEqual(produced.record)

    await expect(reconcileMeasurementProductionReceiptsV1({ dataDir })).resolves.toMatchObject({
      receiptCount: 1,
      repairedEventCount: 0,
    })
    expect((await scanMeasurementOutboxV1({ dataDir })).pending).toHaveLength(1)
  })

  it('returns an empty bounded summary when no production receipt exists', async () => {
    const dataDir = await root()
    await expect(reconcileMeasurementProductionReceiptsV1({ dataDir })).resolves.toEqual({
      kind: 'metrora.measurement-production-recovery-summary',
      version: 1,
      receiptCount: 0,
      repairedEventCount: 0,
    })
  })

  it('fails closed for malformed or misindexed private receipts', async () => {
    const malformedDir = await root()
    await enqueueMeasurementEventV1(event(), {
      dataDir: malformedDir,
      productionKeySha256: PRODUCTION_KEY,
    })
    const malformedReceipt = join(
      malformedDir,
      'outbox',
      'v1',
      'production',
      `${PRODUCTION_KEY}.json`,
    )
    await writeFile(malformedReceipt, '{"broken":true}', 'utf8')
    await expect(reconcileMeasurementProductionReceiptsV1({ dataDir: malformedDir }))
      .rejects.toBeInstanceOf(MeasurementProductionRecoveryIntegrityError)

    const misindexedDir = await root()
    await enqueueMeasurementEventV1(event(), {
      dataDir: misindexedDir,
      productionKeySha256: PRODUCTION_KEY,
    })
    const productionDir = join(misindexedDir, 'outbox', 'v1', 'production')
    const original = join(productionDir, `${PRODUCTION_KEY}.json`)
    const body = await readFile(original, 'utf8')
    const wrong = join(productionDir, `${'b'.repeat(64)}.json`)
    await rename(original, wrong)
    await writeFile(wrong, body, 'utf8')

    await expect(reconcileMeasurementProductionReceiptsV1({ dataDir: misindexedDir }))
      .rejects.toBeInstanceOf(MeasurementProductionRecoveryIntegrityError)
  })
})
