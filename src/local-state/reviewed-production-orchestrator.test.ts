import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ParsedApiCall } from '../types.js'
import type { LocalEndpointIdentityMetadataV1 } from './endpoint-identity.js'
import {
  createLocalPersonalWorkspaceV1,
  type CreateLocalPersonalWorkspaceIntentV1,
} from './local-workspace.js'
import {
  produceCanonicalReviewedMeasurementsV1,
  type CanonicalReviewedProductionCandidateV1,
} from './reviewed-production-orchestrator.js'
import type { LocalReviewedMeasurementContextV1 } from './reviewed-measurement-producer.js'
import {
  setLocalWorkspaceProductionModeV1,
} from './workspace-production-lifecycle.js'

const roots: string[] = []
const NOW = '2026-08-01T20:00:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-reviewed-orchestrator-'))
  roots.push(value)
  return value
}

function identity(): LocalEndpointIdentityMetadataV1 {
  return {
    kind: 'qovrion.local-endpoint-identity',
    version: 1,
    endpointId: 'ep_11111111-2222-4333-8444-555555555555',
    generation: 1,
    keyAlgorithm: 'ed25519',
    publicKeySpkiBase64: Buffer.from('public-key-1').toString('base64'),
    publicKeyFingerprintSha256: 'a'.repeat(64),
    eventIdentityKeyVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }
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

async function createWorkspace(dataDir: string): Promise<void> {
  await createLocalPersonalWorkspaceV1({
    dataDir,
    endpointIdentity: identity(),
    intent: intent(),
    now: () => new Date(NOW),
    randomUUID: uuidSource(),
  })
}

function call(overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  return {
    provider: 'codex',
    source: 'codex-rollout-jsonl-token-count',
    timestamp: new Date(NOW),
    model: 'gpt-5.6-luna',
    modelProvider: 'openai',
    tokens: {
      input: 100,
      output: 20,
      cacheRead: 25,
      cacheWrite: 0,
      reasoning: 5,
    },
    costAssignment: null,
    ...overrides,
  }
}

function context(overrides: Partial<LocalReviewedMeasurementContextV1> = {}): LocalReviewedMeasurementContextV1 {
  return {
    collectorAdapterId: 'codex-rollout-token-count-v1',
    collectorAdapterVersion: '0.9.19',
    sourceKind: 'codex-rollout-jsonl-token-count',
    sourceFingerprintSha256: '1'.repeat(64),
    apiProvider: 'openai',
    sourceSessionId: 'session_1',
    toolName: 'Codex',
    toolVersion: '0.9.19',
    qovrionVersion: '0.9.19',
    openTelemetryGenAiVersion: '1.37.0',
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

function options(dataDir: string, scanCanonicalCandidates: () => Promise<{
  candidates: readonly CanonicalReviewedProductionCandidateV1[]
  withheldCount: number
  failedCount: number
}>) {
  return {
    dataDir,
    endpointIdentity: identity(),
    eventIdentityKey: Buffer.alloc(32, 7),
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
    await createWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 2,
      failedCount: 1,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, scan))).resolves.toEqual({
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
    await createWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))

    const first = await produceCanonicalReviewedMeasurementsV1(options(dataDir, scan))
    const second = await produceCanonicalReviewedMeasurementsV1(options(dataDir, scan))

    expect(first).toMatchObject({ producedCount: 1, existingCount: 0 })
    expect(second).toMatchObject({ producedCount: 0, existingCount: 1 })
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('checks paused mode before scanning or mutating evidence', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'paused',
      now: () => new Date(NOW),
    })
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 99,
      failedCount: 99,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, scan))).resolves.toEqual({
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
  })

  it('serializes pause behind an in-flight production pass', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    const entered = deferred<void>()
    const release = deferred<void>()
    const scan = vi.fn(async () => {
      entered.resolve()
      await release.promise
      return { candidates: [], withheldCount: 0, failedCount: 0 }
    })

    const production = produceCanonicalReviewedMeasurementsV1(options(dataDir, scan))
    await entered.promise

    let pauseSettled = false
    const pause = setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
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
    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, secondScan))).resolves.toMatchObject({
      outcome: 'paused',
      scanned: false,
    })
    expect(secondScan).not.toHaveBeenCalled()
  })

  it('serializes concurrent production passes and deduplicates the second pass', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))

    const [first, second] = await Promise.all([
      produceCanonicalReviewedMeasurementsV1(options(dataDir, scan)),
      produceCanonicalReviewedMeasurementsV1(options(dataDir, scan)),
    ])

    expect([first.producedCount, second.producedCount].sort()).toEqual([0, 1])
    expect([first.existingCount, second.existingCount].sort()).toEqual([0, 1])
  })

  it('fails the action on contradictory trusted evidence instead of hiding it in failedCount', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate({}, { apiProvider: 'anthropic' })],
      withheldCount: 0,
      failedCount: 0,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, scan))).rejects.toThrow()

    const corrected = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))
    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, corrected))).resolves.toMatchObject({
      producedCount: 1,
      existingCount: 0,
    })
  })

  it('rejects malformed scanner counts before producing candidates', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    const scan = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: -1,
      failedCount: 0,
    }))

    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, scan))).rejects.toThrow()

    const corrected = vi.fn(async () => ({
      candidates: [candidate()],
      withheldCount: 0,
      failedCount: 0,
    }))
    await expect(produceCanonicalReviewedMeasurementsV1(options(dataDir, corrected))).resolves.toMatchObject({
      producedCount: 1,
      existingCount: 0,
    })
  })
})
