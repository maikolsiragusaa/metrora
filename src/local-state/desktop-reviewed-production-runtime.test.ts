import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CostAssignmentV1 } from '../pricing/cost-assignment.js'
import type { ParsedApiCall } from '../types.js'
import {
  attachDesktopReviewedProductionV1,
  DesktopReviewedProductionUnavailableError,
} from './desktop-reviewed-production-runtime.js'
import { createDesktopWorkspaceRuntimeV1 } from './desktop-workspace-runtime.js'
import { loadOrCreateLocalEndpointIdentityV1 } from './endpoint-identity.js'
import type { LocalReviewedMeasurementContextV1 } from './reviewed-measurement-producer.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

const roots: string[] = []
const NOW = '2026-08-01T22:00:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-desktop-production-'))
  roots.push(value)
  return value
}

function tokenAssignment(): CostAssignmentV1 {
  return {
    version: 1,
    kind: 'token-price',
    amountMicrosUsd: 123_456,
    priceRecordId: 'openai.test-model.standard.2026-08-01',
    priceOrigin: 'reviewed-book',
    rateSelection: { kind: 'base' },
  }
}

function call(): ParsedApiCall {
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
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: NOW,
    bashCommands: [],
    deduplicationKey: 'desktop-production-call-1',
  }
}

function context(): LocalReviewedMeasurementContextV1 {
  return {
    session: { mode: 'omit' },
    tool: { name: 'Codex', version: '0.9.19' },
    collector: {
      adapterVersion: '0.9.19',
      sourceFingerprintSha256: '1'.repeat(64),
    },
    genAi: {
      operationName: 'other',
      providerName: 'openai',
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('desktop reviewed-production runtime', () => {
  it('produces, deduplicates, pauses before scanning, and refreshes public evidence', async () => {
    const dataDir = await root()
    const identity = await loadOrCreateLocalEndpointIdentityV1({
      dataDir,
      protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 7)),
      now: () => new Date(NOW),
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      randomBytes: size => Buffer.alloc(size, 9),
    })
    const base = createDesktopWorkspaceRuntimeV1({
      dataDir,
      identity,
      platform: { os: 'windows', architecture: 'x64' },
      metroraVersion: '0.9.19',
      collectorVersion: '0.9.19',
      now: () => new Date(NOW),
    })
    const scan = vi.fn(async input => {
      expect(input).toEqual({
        endpointId: identity.metadata.endpointId,
        adapterVersion: '0.9.19',
      })
      return {
        candidates: [{ call: call(), context: context() }],
        withheldCount: 2,
        failedCount: 1,
      }
    })
    const runtime = attachDesktopReviewedProductionV1({
      runtime: base,
      dataDir,
      identity,
      adapterVersion: '0.9.19',
      scanCanonicalCandidates: scan,
      now: () => new Date(NOW),
    })

    await runtime.createWorkspace({
      displayName: 'Local Workspace',
      endpointDisplayName: 'Primary desktop',
    })

    const first = await runtime.produceReviewedMeasurements()
    expect(first).toMatchObject({
      summary: {
        outcome: 'completed',
        scanned: true,
        eligibleCount: 1,
        producedCount: 1,
        existingCount: 0,
        withheldCount: 2,
        failedCount: 1,
      },
      snapshot: {
        evidence: { pendingEventCount: 1, unbatchedEventCount: 1 },
      },
    })

    const second = await runtime.produceReviewedMeasurements()
    expect(second).toMatchObject({
      summary: { producedCount: 0, existingCount: 1 },
      snapshot: { evidence: { pendingEventCount: 1, unbatchedEventCount: 1 } },
    })

    await runtime.setProductionMode('paused')
    const paused = await runtime.produceReviewedMeasurements()
    expect(paused).toMatchObject({
      summary: {
        outcome: 'paused',
        scanned: false,
        eligibleCount: 0,
        producedCount: 0,
        existingCount: 0,
      },
      snapshot: {
        productionLifecycle: { mode: 'paused' },
        evidence: { pendingEventCount: 1 },
      },
    })
    expect(scan).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('fails explicitly when the lazy scanner is not configured', async () => {
    const dataDir = await root()
    const identity = await loadOrCreateLocalEndpointIdentityV1({
      dataDir,
      protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 7)),
      now: () => new Date(NOW),
      randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      randomBytes: size => Buffer.alloc(size, 9),
    })
    const base = createDesktopWorkspaceRuntimeV1({
      dataDir,
      identity,
      platform: { os: 'windows', architecture: 'x64' },
      metroraVersion: '0.9.19',
      collectorVersion: '0.9.19',
      now: () => new Date(NOW),
    })
    const runtime = attachDesktopReviewedProductionV1({
      runtime: base,
      dataDir,
      identity,
      adapterVersion: '0.9.19',
      now: () => new Date(NOW),
    })

    await expect(runtime.produceReviewedMeasurements())
      .rejects.toBeInstanceOf(DesktopReviewedProductionUnavailableError)
    runtime.dispose()
  })
})
