import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import {
  acknowledgeMeasurementEventV1,
  enqueueMeasurementEventV1,
  quarantineMeasurementOutboxFileV1,
  readPendingMeasurementEventsV1,
  scanMeasurementOutboxV1,
} from './measurement-outbox.js'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-outbox-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function event(id: string, outputTokens = 20): UsageMeasurementEventV1 {
  return {
    specversion: '1.0',
    id,
    source: 'urn:metrora:endpoint:ep_test',
    type: USAGE_MEASUREMENT_EVENT_TYPE,
    time: '2026-07-31T14:00:00.000Z',
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
        responseModel: 'gpt-5.5',
      },
      usage: {
        calls: 1,
        inputTokens: 100,
        outputTokens,
        cacheReadTokens: 30,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
      },
      cost: { kind: 'unavailable' },
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

describe.sequential('local measurement outbox v1', () => {
  it('enqueues immutable events with monotonic sequences and idempotent duplicates', async () => {
    const dataDir = await root()
    const first = await enqueueMeasurementEventV1(event('evt_alpha'), {
      dataDir,
      now: () => new Date('2026-07-31T14:01:00.000Z'),
    })
    const duplicate = await enqueueMeasurementEventV1(event('evt_alpha'), { dataDir })
    const second = await enqueueMeasurementEventV1(event('evt_beta'), { dataDir })

    expect(first.status).toBe('enqueued')
    expect(first.record.sequence).toBe(1)
    expect(duplicate).toEqual({ status: 'duplicate', record: first.record })
    expect(second.record.sequence).toBe(2)
    expect((await readPendingMeasurementEventsV1(10, { dataDir })).map(record => record.event.id))
      .toEqual(['evt_alpha', 'evt_beta'])
  })

  it('serializes concurrent retries without duplicate files or sequence reuse', async () => {
    const dataDir = await root()
    const results = await Promise.all(
      Array.from({ length: 12 }, () => enqueueMeasurementEventV1(event('evt_concurrent'), { dataDir })),
    )
    expect(results.filter(result => result.status === 'enqueued')).toHaveLength(1)
    expect(new Set(results.map(result => result.record.sequence))).toEqual(new Set([1]))
    expect((await readdir(join(dataDir, 'outbox', 'v1', 'events'))).filter(name => name.endsWith('.json')))
      .toHaveLength(1)
  })

  it('rejects the same event id with a different payload', async () => {
    const dataDir = await root()
    await enqueueMeasurementEventV1(event('evt_collision', 20), { dataDir })
    await expect(enqueueMeasurementEventV1(event('evt_collision', 21), { dataDir }))
      .rejects.toThrow(/collision/)
  })

  it('records acknowledgements separately and never deletes the event', async () => {
    const dataDir = await root()
    await enqueueMeasurementEventV1(event('evt_ack'), { dataDir })
    const ack = await acknowledgeMeasurementEventV1('evt_ack', {
      dataDir,
      receiptId: 'receipt_123',
      now: () => new Date('2026-07-31T14:05:00.000Z'),
    })
    const duplicate = await acknowledgeMeasurementEventV1('evt_ack', {
      dataDir,
      receiptId: 'receipt_123',
    })

    expect(ack.status).toBe('acknowledged')
    expect(duplicate.status).toBe('duplicate')
    const scan = await scanMeasurementOutboxV1({ dataDir })
    expect(scan.pending).toHaveLength(0)
    expect(scan.acknowledged).toHaveLength(1)
    expect(await readdir(join(dataDir, 'outbox', 'v1', 'events'))).toHaveLength(1)
    await expect(acknowledgeMeasurementEventV1('evt_ack', {
      dataDir,
      receiptId: 'different_receipt',
    })).rejects.toThrow(/different receipt/)
  })

  it('allows crash-created sequence gaps without reusing a reserved number', async () => {
    const dataDir = await root()
    const rootDir = join(dataDir, 'outbox', 'v1')
    await enqueueMeasurementEventV1(event('evt_before_gap'), { dataDir })
    await writeFile(join(rootDir, 'next-sequence.json'), JSON.stringify({ version: 1, nextSequence: 9 }))

    const after = await enqueueMeasurementEventV1(event('evt_after_gap'), { dataDir })
    expect(after.record.sequence).toBe(9)
    expect((await readPendingMeasurementEventsV1(10, { dataDir })).map(record => record.sequence))
      .toEqual([1, 9])
  })

  it('excludes a valid quarantined event without rewriting its source record', async () => {
    const dataDir = await root()
    await enqueueMeasurementEventV1(event('evt_quarantine'), { dataDir })
    const eventsDir = join(dataDir, 'outbox', 'v1', 'events')
    const [file] = (await readdir(eventsDir)).filter(name => name.endsWith('.json'))
    const sourceBefore = await readFile(join(eventsDir, file!))

    const marker = await quarantineMeasurementOutboxFileV1(file!, 'source requires manual review', {
      dataDir,
      now: () => new Date('2026-07-31T14:09:00.000Z'),
    })
    const duplicate = await quarantineMeasurementOutboxFileV1(file!, 'source requires manual review', { dataDir })
    expect(duplicate).toEqual(marker)
    const scan = await scanMeasurementOutboxV1({ dataDir })
    expect(scan.pending).toHaveLength(0)
    expect(scan.acknowledged).toHaveLength(0)
    expect(scan.invalid).toHaveLength(0)
    expect(scan.quarantined).toEqual([marker])
    expect(await readFile(join(eventsDir, file!))).toEqual(sourceBefore)
    await expect(quarantineMeasurementOutboxFileV1(file!, 'a different decision', { dataDir }))
      .rejects.toThrow(/different quarantine decision/)
  })

  it('surfaces corrupt immutable events and records a separate quarantine marker', async () => {
    const dataDir = await root()
    await enqueueMeasurementEventV1(event('evt_corrupt'), { dataDir })
    const eventsDir = join(dataDir, 'outbox', 'v1', 'events')
    const [file] = (await readdir(eventsDir)).filter(name => name.endsWith('.json'))
    expect(file).toBeDefined()
    await writeFile(join(eventsDir, file!), '{broken')

    const before = await scanMeasurementOutboxV1({ dataDir })
    expect(before.invalid).toHaveLength(1)
    const marker = await quarantineMeasurementOutboxFileV1(file!, 'manual integrity review', {
      dataDir,
      now: () => new Date('2026-07-31T14:10:00.000Z'),
    })
    const after = await scanMeasurementOutboxV1({ dataDir })
    expect(after.invalid).toHaveLength(1)
    expect(after.quarantined).toEqual([marker])
    expect(await readFile(join(eventsDir, file!), 'utf-8')).toBe('{broken')
  })

  it('rejects malformed counters, exhausted sequences and invalid read limits', async () => {
    const dataDir = await root()
    await enqueueMeasurementEventV1(event('evt_counter_seed'), { dataDir })
    const counterPath = join(dataDir, 'outbox', 'v1', 'next-sequence.json')
    await writeFile(counterPath, '{bad')
    await expect(enqueueMeasurementEventV1(event('evt_counter_next'), { dataDir }))
      .rejects.toThrow(/recovery is required/)

    await writeFile(counterPath, JSON.stringify({ version: 1, nextSequence: Number.MAX_SAFE_INTEGER }))
    await expect(enqueueMeasurementEventV1(event('evt_counter_exhausted'), { dataDir }))
      .rejects.toThrow(/sequence space is exhausted/)
    await expect(readPendingMeasurementEventsV1(0, { dataDir })).rejects.toThrow(/1 to 10000/)
  })
})
