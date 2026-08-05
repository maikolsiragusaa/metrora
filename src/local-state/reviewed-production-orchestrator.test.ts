import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CostAssignmentV1 } from '../pricing/cost-assignment.js'
import type { ParsedApiCall } from '../types.js'
import {
  loadOrCreateLocalEndpointIdentityV1,
  type LoadedLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import {
  createLocalPersonalWorkspaceV1,
  type CreateLocalPersonalWorkspaceIntentV1,
} from './local-workspace.js'
import { scanMeasurementOutboxV1 } from './measurement-outbox.js'
import {
  produceCanonicalReviewedMeasurementsV1,
  type CanonicalReviewedProductionCandidateV1,
} from './reviewed-production-orchestrator.js'
import type { LocalReviewedMeasurementContextV1 } from './reviewed-measurement-producer.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'
import { setLocalWorkspaceProductionModeV1 } from './workspace-production-lifecycle.js'

const roots: string[] = []
const NOW = '2026-08-01T20:00:00.000Z'
const MASTER_KEY = Buffer.alloc(32, 7)

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-reviewed-orchestrator-'))
  roots.push(value)
  return value
}

function intent(): CreateLocalPersonalWorkspaceIntentV1 {
  return {
    workspace: { displayName: 'Maikol Workspace', slug: 'maikol-workspace' },
    endpoint: {
      displayName: 'Windows workstation',
      platform: { os: 'windows', architecture: 'x64' },
      metroraVersion: '0.9.19',
      collectorVersion: '0.9.19',
      capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
    },
  }
}

function uuidSource(): () => string {
  let index = 0
  return () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`
}

async function initializeWorkspace(dataDir: string): Promise<LoadedLocalEndpointIdentityV1> {
  const identity = await loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(MASTER_KEY),
    now: () => new Date(NOW),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    randomBytes: size => Buffer.alloc(size, 9),
  })
  await createLocalPersonalWorkspaceV1({
    dataDir,
    endpointIdentity: identity.metadata,
    intent: intent(),
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

function call(overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  return {
    provider: 'codex',
    model: 'historically-priced-test-model',
    modelProvider: 'openai',
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
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: NOW,
    bashCommands: [],
    deduplicationKey: 'private-message-id',
    ...overrides,
  }
}

function context(overrides: Partial<LocalReviewedMeasurementContextV1> = {}): LocalReviewedMeasurementContextV1 {
  return {
    session: { mode: 'include', sessionId: 'session_01' },
    tool: { name: 'Codex', version: '0.9.19' },
    collector: {
      adapterVersion: '0.9.19',
      sourceFingerprintSha256: '1'.repeat(64),
    },
    genAi: {
      operationName: 'invoke_agent',
      providerName: 'openai',
      requestModel: 'historically-priced-test-model',
    },
    ...overrides,
  }
}

function candidate(
  callOverrides: Partial<ParsedApiCall> = {},
  contextOverrides: Partial<LocalReviewedMeasurementContextV1> = {},
): CanonicalReviewedProductionCandidateV1 {
  return { call: call(callOverrides), context: context(contextOverrides) }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function options(
  dataDir: string,
  identity: LoadedLocalEndpointIdentityV1,
  scanCanonicalCandidates: () => Promise<{
    candidates: readonly CanonicalReviewedProductionCandidateV1[]
    withheldCount: number
    failedCount: number
  }>,
) {
  return {
    dataDir,
    identity,
    scanCanonicalCandidates,
    now: () => new Date(NOW),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('canonical reviewed-production orchestrator v1', () => {
  it('produces trusted candidates and preserves bounded scanner counts', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 2,
      failedCount: 1,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, scan))).resolves.toEqual({
      kind: 'metrora.canonical-reviewed-production-summary',
      version: 1,
      outcome: 'completed',
      scanned: true,
      eligibleCount: 1,
      producedCount: 1,
      existingCount: 0,
      withheldCount: 2,
      failedCount: 1,
    })
    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('replays idempotently through the existing private production receipt', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))

    const first = await produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, scan))
    const second = await produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, scan))

    expect(first).toMatchObject({ producedCount: 1, existingCount: 0 })
    expect(second).toMatchObject({ producedCount: 0, existingCount: 1 })
    expect((await scanMeasurementOutboxV1({ dataDir })).pending).toHaveLength(1)
  })

  it('checks paused mode before scanning or mutating evidence', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity.metadata,
      mode: 'paused',
      now: () => new Date(NOW),
    })
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, scan))).resolves.toEqual({
      kind: 'metrora.canonical-reviewed-production-summary',
      version: 1,
      outcome: 'paused',
      scanned: false,
      eligibleCount: 0,
      producedCount: 0,
      existingCount: 0,
      withheldCount: 0,
      failedCount: 0,
    })
    expect(scan).not.toHaveBeenCalled()
    expect((await scanMeasurementOutboxV1({ dataDir })).pending).toEqual([])
  })

  it('serializes pause behind an in-flight production pass', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const entered = deferred<void>()
    const release = deferred<void>()
    const scan = vi.fn(async () => {
      entered.resolve()
      await release.promise
      return { candidates: [], withheldCount: 0, failedCount: 0 }
    })

    const production = produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, scan))
    await entered.promise

    let pauseSettled = false
    const pause = setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity.metadata,
      mode: 'paused',
      now: () => new Date(NOW),
    }).then(result => {
      pauseSettled = true
      return result
    })

    await new Promise(resolve => setTimeout(resolve, 25))
    expect(pauseSettled).toBe(false)

    release.resolve()
    await expect(production).resolves.toMatchObject({ outcome: 'completed', scanned: true })
    await expect(pause).resolves.toMatchObject({
      outcome: 'changed',
      lifecycle: { mode: 'paused', revision: 1 },
    })

    const secondScan = vi.fn(async () => ({ candidates: [candidate()], withheldCount: 0, failedCount: 0 }))
    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, secondScan))).resolves.toMatchObject({
      outcome: 'paused',
      scanned: false,
    })
    expect(secondScan).not.toHaveBeenCalled()
  })

  it('serializes concurrent production passes and deduplicates the second pass', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))

    const [first, second] = await Promise.all([
      produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, scan)),
      produceCanonicalReviewedMeasurementsV1(options(dataDir, identity, scan)),
    ])

    expect([first.producedCount, second.producedCount].sort()).toEqual([0, 1])
    expect([first.existingCount, second.existingCount].sort()).toEqual([0, 1])
    expect((await scanMeasurementOutboxV1({ dataDir })).pending).toHaveLength(1)
  })

  it('fails the action when the trusted scanner marks an ineligible candidate as eligible', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const contradictory = vi.fn(async () => ({
      candidates: [candidate({}, {
        genAi: { ...context().genAi, providerName: 'anthropic' },
      })],
      withheldCount: 0,
      failedCount: 0,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(
      options(dataDir, identity, contradictory),
    )).rejects.toThrow(/trusted canonical production candidate was withheld/)
    expect((await scanMeasurementOutboxV1({ dataDir })).pending).toEqual([])

    const corrected = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))
    await expect(produceCanonicalReviewedMeasurementsV1(
      options(dataDir, identity, corrected),
    )).resolves.toMatchObject({ producedCount: 1, existingCount: 0 })
  })

  it('rejects malformed scanner counts before producing candidates', async () => {
    const dataDir = await root()
    const identity = await initializeWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: -1,
      failedCount: 0,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(
      options(dataDir, identity, scan),
    )).rejects.toThrow()
    expect((await scanMeasurementOutboxV1({ dataDir })).pending).toEqual([])
  })
})
