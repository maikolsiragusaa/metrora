import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CostAssignmentV1 } from '../pricing/cost-assignment.js'
import type { ParsedApiCall } from '../types.js'
import {
  loadOrCreateLocalEndpointIdentityV1,
  type LoadedLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import { createLocalPersonalWorkspaceV1 } from './local-workspace.js'
import { scanMeasurementOutboxV1 } from './measurement-outbox.js'
import {
  LocalWorkspaceRequiredError,
  produceLocalReviewedMeasurementV1,
} from './reviewed-measurement-producer.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

const roots: string[] = []
const NOW = '2026-08-01T14:00:00.000Z'
const SOURCE_SHA = 'a'.repeat(64)

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-reviewed-producer-'))
  roots.push(value)
  return value
}

function uuidSource() {
  let index = 0
  return () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`
}

async function createIdentity(dataDir: string, endpointUuid = '11111111-2222-4333-8444-555555555555') {
  return loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 7)),
    now: () => new Date(NOW),
    randomUUID: () => endpointUuid,
    randomBytes: size => Buffer.alloc(size, 9),
  })
}

async function initializeWorkspace(dataDir: string): Promise<LoadedLocalEndpointIdentityV1> {
  const identity = await createIdentity(dataDir)
  await createLocalPersonalWorkspaceV1({
    dataDir,
    endpointIdentity: identity.metadata,
    intent: {
      workspace: {
        displayName: 'Local Workspace',
        slug: 'local-workspace',
      },
      endpoint: {
        displayName: 'Windows workstation',
        platform: { os: 'windows', architecture: 'x64' },
        metroraVersion: '0.9.19',
        collectorVersion: '0.9.19',
        capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
      },
    },
    now: () => new Date(NOW),
    randomUUID: uuidSource(),
  })
  return identity
}

function tokenAssignment(amountMicrosUsd = 123_456): CostAssignmentV1 {
  return {
    version: 1,
    kind: 'token-price',
    amountMicrosUsd,
    priceRecordId: 'openai.test-model.standard.2026-08-01',
    priceOrigin: 'reviewed-book',
    rateSelection: { kind: 'base' },
  }
}

function codexCall(overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  return {
    provider: 'codex',
    model: 'historically-priced-test-model',
    reasoningLevel: 'high',
    reasoningLevelSource: 'explicit',
    usage: {
      inputTokens: 60,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 40,
      cachedInputTokens: 40,
      reasoningTokens: 5,
      webSearchRequests: 0,
    },
    costUSD: 0.123456,
    costAssignment: tokenAssignment(),
    tools: ['Read'],
    mcpTools: ['mcp__private__lookup'],
    skills: ['private-skill'],
    subagentTypes: ['reviewer'],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: NOW,
    bashCommands: ['cat /private/secret.txt'],
    deduplicationKey: 'private-message-id',
    toolSequence: [[{ tool: 'Read', file: '/private/secret.txt' }]],
    ...overrides,
  }
}

function context() {
  return {
    repositoryId: 'repository_01',
    projectId: 'project_01',
    accountId: 'account_01',
    session: { mode: 'include' as const, sessionId: 'session_01' },
    tool: { name: 'Codex', version: '1.0.0' },
    collector: {
      adapterVersion: '0.9.19',
      sourceFingerprintSha256: SOURCE_SHA,
    },
    genAi: {
      operationName: 'invoke_agent' as const,
      providerName: 'openai',
      requestModel: 'historically-priced-test-model',
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('local reviewed measurement producer v1', () => {
  it('enqueues a reviewed call from its immutable historical assignment and deduplicates repeats', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)

    const first = await produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall(),
      context: context(),
      now: () => new Date(NOW),
    })
    expect(first.status).toBe('enqueued')
    if (first.status !== 'enqueued') return
    expect(first.profileId).toBe('codex-rollout-token-count-v1')
    expect(first.record.event.data.cost).toEqual({
      kind: 'estimated',
      amountMicrosUsd: 123_456,
      method: 'token-pricing',
    })
    expect(first.record.event.data.workspaceId).toMatch(/^workspace_/)
    expect(first.record.event.data.endpointId).toBe(identity.metadata.endpointId)

    const second = await produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall(),
      context: context(),
      now: () => new Date(NOW),
    })
    expect(second.status).toBe('duplicate')
    if (second.status !== 'duplicate') return
    expect(second.record.sequence).toBe(first.record.sequence)
    expect(second.record.eventSha256).toBe(first.record.eventSha256)

    const scan = await scanMeasurementOutboxV1({ dataDir })
    expect(scan.pending).toHaveLength(1)
    expect(scan.invalid).toEqual([])
    expect(scan.pending[0]).toEqual(first.record)
  })

  it('never falls back to mutable current pricing when the immutable assignment is absent or contradictory', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)

    const missing = await produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall({
        model: 'gpt-5.5',
        costUSD: 99,
        costAssignment: undefined,
        deduplicationKey: 'missing-assignment',
      }),
      context: {
        ...context(),
        genAi: { ...context().genAi, requestModel: 'gpt-5.5' },
      },
    })
    expect(missing.status).toBe('enqueued')
    if (missing.status !== 'enqueued') return
    expect(missing.record.event.data.cost).toEqual({ kind: 'unavailable' })

    const contradictory = await produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall({
        costUSD: 0.5,
        costAssignment: tokenAssignment(123_456),
        deduplicationKey: 'contradictory-assignment',
      }),
      context: context(),
    })
    expect(contradictory.status).toBe('enqueued')
    if (contradictory.status !== 'enqueued') return
    expect(contradictory.record.event.data.cost).toEqual({ kind: 'unavailable' })
  })

  it('preserves metered, explicit-zero, unavailable, and legacy-frozen distinctions', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)

    const cases: Array<{
      key: string
      costUSD: number
      assignment: CostAssignmentV1
      expected: unknown
    }> = [
      {
        key: 'metered',
        costUSD: 0.25,
        assignment: { version: 1, kind: 'metered', amountMicrosUsd: 250_000, source: 'client' },
        expected: { kind: 'metered', amountMicrosUsd: 250_000, source: 'client' },
      },
      {
        key: 'explicit-zero',
        costUSD: 0,
        assignment: {
          version: 1,
          kind: 'explicit-zero',
          amountMicrosUsd: 0,
          reason: 'free-route',
          priceRecordId: 'openai.free-route.2026-08-01',
          priceOrigin: 'reviewed-book',
        },
        expected: { kind: 'estimated', amountMicrosUsd: 0, method: 'token-pricing' },
      },
      {
        key: 'unavailable',
        costUSD: 0,
        assignment: { version: 1, kind: 'unavailable', reason: 'no-price-record' },
        expected: { kind: 'unavailable' },
      },
      {
        key: 'legacy-frozen',
        costUSD: 0.75,
        assignment: {
          version: 1,
          kind: 'legacy-frozen',
          amountMicrosUsd: 750_000,
          reason: 'inherited-token-pricing',
        },
        expected: { kind: 'estimated', amountMicrosUsd: 750_000, method: 'other' },
      },
    ]

    for (const testCase of cases) {
      const produced = await produceLocalReviewedMeasurementV1({
        dataDir,
        identity,
        call: codexCall({
          costUSD: testCase.costUSD,
          costAssignment: testCase.assignment,
          deduplicationKey: testCase.key,
        }),
        context: context(),
      })
      expect(produced.status).toBe('enqueued')
      if (produced.status === 'enqueued') {
        expect(produced.record.event.data.cost).toEqual(testCase.expected)
      }
    }
  })

  it('withholds unreviewed evidence and provider mismatch without touching the outbox', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)

    const unreviewed = await produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall({ provider: 'cursor' }),
      context: context(),
    })
    expect(unreviewed).toEqual({ status: 'withheld', reason: 'unreviewed-evidence-path' })

    const mismatch = await produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall({ modelProvider: 'openai', deduplicationKey: 'provider-mismatch' }),
      context: {
        ...context(),
        genAi: { ...context().genAi, providerName: 'anthropic' },
      },
    })
    expect(mismatch).toEqual({ status: 'withheld', reason: 'model-provider-mismatch' })

    const scan = await scanMeasurementOutboxV1({ dataDir })
    expect(scan.pending).toEqual([])
    expect(scan.acknowledged).toEqual([])
    expect(scan.invalid).toEqual([])
  })

  it('requires an existing local workspace and rejects a foreign endpoint identity', async () => {
    const withoutWorkspaceDir = await root()
    const identityWithoutWorkspace = await createIdentity(withoutWorkspaceDir)
    await expect(produceLocalReviewedMeasurementV1({
      dataDir: withoutWorkspaceDir,
      identity: identityWithoutWorkspace,
      call: codexCall(),
      context: context(),
    })).rejects.toBeInstanceOf(LocalWorkspaceRequiredError)

    const dataDir = await root()
    await initializeWorkspace(dataDir)
    const foreignDir = await root()
    const foreignIdentity = await createIdentity(
      foreignDir,
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    await expect(produceLocalReviewedMeasurementV1({
      dataDir,
      identity: foreignIdentity,
      call: codexCall(),
      context: context(),
    })).rejects.toThrow(/different endpoint identity/)
  })

  it('serializes concurrent production into one immutable outbox record', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const results = await Promise.all(Array.from({ length: 8 }, () => produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall(),
      context: context(),
      now: () => new Date(NOW),
    })))

    expect(results.filter(result => result.status === 'enqueued')).toHaveLength(1)
    expect(results.filter(result => result.status === 'duplicate')).toHaveLength(7)
    const records = results.flatMap(result =>
      result.status === 'withheld' ? [] : [result.record])
    expect(new Set(records.map(record => record.sequence)).size).toBe(1)
    expect(new Set(records.map(record => record.eventSha256)).size).toBe(1)
  })

  it('keeps rich call details and endpoint secrets out of the published record', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const produced = await produceLocalReviewedMeasurementV1({
      dataDir,
      identity,
      call: codexCall(),
      context: context(),
    })
    expect(produced.status).toBe('enqueued')
    if (produced.status !== 'enqueued') return

    const serialized = JSON.stringify(produced.record)
    expect(serialized).not.toContain('private-message-id')
    expect(serialized).not.toContain('/private/secret.txt')
    expect(serialized).not.toContain('mcp__private__lookup')
    expect(serialized).not.toContain('private-skill')
    expect(serialized).not.toContain('reviewer')
    expect(serialized).not.toContain(Buffer.from(identity.eventIdentityKey).toString('base64'))
    expect(serialized).not.toContain(Buffer.from(identity.privateKeyPkcs8).toString('base64'))

    const outboxDir = join(dataDir, 'outbox', 'v1', 'events')
    const [eventFile] = await readdir(outboxDir)
    expect(eventFile).toBeDefined()
    const onDisk = await readFile(join(outboxDir, eventFile!), 'utf-8')
    expect(onDisk).toBe(serialized)
  })
})
