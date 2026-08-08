import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createLocalPersonalWorkspaceV1,
  type CreateLocalPersonalWorkspaceIntentV1,
} from './local-workspace.js'
import type { LocalEndpointIdentityMetadataV1 } from './endpoint-identity.js'
import {
  inspectLocalWorkspaceProductionLifecycleV1,
  LocalWorkspaceProductionLifecycleRecoveryRequiredError,
  LocalWorkspaceProductionLifecycleStateV1Schema,
  LocalWorkspaceProductionLifecycleWorkspaceRequiredError,
  setLocalWorkspaceProductionModeV1,
} from './workspace-production-lifecycle.js'

const roots: string[] = []
const NOW = '2026-08-01T18:00:00.000Z'
const LATER = '2026-08-01T19:00:00.000Z'
const LATEST = '2026-08-01T20:00:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-production-lifecycle-'))
  roots.push(value)
  return value
}

function identity(
  generation = 1,
  fingerprint = 'a'.repeat(64),
): LocalEndpointIdentityMetadataV1 {
  return {
    kind: 'metrora.local-endpoint-identity',
    version: 1,
    endpointId: 'ep_11111111-2222-4333-8444-555555555555',
    generation,
    keyAlgorithm: 'ed25519',
    publicKeySpkiBase64: Buffer.from(`public-key-${generation}`).toString('base64'),
    publicKeyFingerprintSha256: fingerprint,
    eventIdentityKeyVersion: generation,
    createdAt: NOW,
    updatedAt: generation === 1 ? NOW : LATER,
    ...(generation > 1 ? { rotatedAt: LATER } : {}),
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

function lifecyclePath(dataDir: string): string {
  return join(dataDir, 'workspace', 'workspace-production-lifecycle.v1.json')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('local Workspace production lifecycle v1', () => {
  it('requires an explicit local Workspace before inspection or mutation', async () => {
    const dataDir = await root()

    await expect(inspectLocalWorkspaceProductionLifecycleV1({
      dataDir,
      endpointIdentity: identity(),
    })).rejects.toBeInstanceOf(LocalWorkspaceProductionLifecycleWorkspaceRequiredError)

    await expect(setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'paused',
    })).rejects.toBeInstanceOf(LocalWorkspaceProductionLifecycleWorkspaceRequiredError)
  })

  it('treats absent lifecycle state as active without creating a file', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)

    expect(await inspectLocalWorkspaceProductionLifecycleV1({
      dataDir,
      endpointIdentity: identity(),
    })).toEqual({
      mode: 'active',
      revision: 0,
      persisted: false,
      updatedAt: null,
    })

    const unchanged = await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'active',
      now: () => new Date(NOW),
    })
    expect(unchanged).toEqual({
      outcome: 'unchanged',
      lifecycle: {
        mode: 'active',
        revision: 0,
        persisted: false,
        updatedAt: null,
      },
    })
    await expect(access(lifecyclePath(dataDir))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('orders valid ISO timestamps by instant rather than textual offset', () => {
    expect(() => LocalWorkspaceProductionLifecycleStateV1Schema.parse({
      kind: 'metrora.local-workspace-production-lifecycle',
      version: 1,
      workspaceId: 'workspace_00000000-0000-4000-8000-000000000001',
      endpointId: identity().endpointId,
      mode: 'paused',
      revision: 1,
      createdAt: '2026-08-01T20:00:00+02:00',
      updatedAt: '2026-08-01T18:30:00Z',
    })).not.toThrow()
  })

  it('pauses only future Workspace production through one private atomic state file', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)

    const paused = await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'paused',
      now: () => new Date(LATER),
    })

    expect(paused).toEqual({
      outcome: 'changed',
      lifecycle: {
        mode: 'paused',
        revision: 1,
        persisted: true,
        updatedAt: LATER,
      },
    })
    expect(await inspectLocalWorkspaceProductionLifecycleV1({
      dataDir,
      endpointIdentity: identity(),
    })).toEqual(paused.lifecycle)

    const text = await readFile(lifecyclePath(dataDir), 'utf-8')
    const stored = JSON.parse(text) as Record<string, unknown>
    expect(stored).toMatchObject({
      kind: 'metrora.local-workspace-production-lifecycle',
      version: 1,
      workspaceId: 'workspace_00000000-0000-4000-8000-000000000001',
      endpointId: identity().endpointId,
      mode: 'paused',
      revision: 1,
      createdAt: LATER,
      updatedAt: LATER,
    })
    expect(text).not.toContain('privateKey')
    expect(text).not.toContain('eventIdentityKey')
    expect(text).not.toContain('prompt')
    expect(text).not.toContain('sourcePath')
  })

  it('serializes concurrent pause requests into one transition', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)

    const results = await Promise.all(Array.from({ length: 8 }, () => setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'paused',
      now: () => new Date(LATER),
    })))

    expect(results.filter(result => result.outcome === 'changed')).toHaveLength(1)
    expect(results.filter(result => result.outcome === 'unchanged')).toHaveLength(7)
    expect(new Set(results.map(result => result.lifecycle.revision))).toEqual(new Set([1]))
    expect(new Set(results.map(result => result.lifecycle.mode))).toEqual(new Set(['paused']))
  })

  it('resumes idempotently without deleting or resetting lifecycle history', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'paused',
      now: () => new Date(LATER),
    })

    const resumed = await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'active',
      now: () => new Date(LATEST),
    })
    const repeated = await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'active',
      now: () => new Date('2026-08-01T21:00:00.000Z'),
    })

    expect(resumed).toEqual({
      outcome: 'changed',
      lifecycle: {
        mode: 'active',
        revision: 2,
        persisted: true,
        updatedAt: LATEST,
      },
    })
    expect(repeated).toEqual({ outcome: 'unchanged', lifecycle: resumed.lifecycle })

    const stored = JSON.parse(await readFile(lifecyclePath(dataDir), 'utf-8')) as Record<string, unknown>
    expect(stored).toMatchObject({
      mode: 'active',
      revision: 2,
      createdAt: LATER,
      updatedAt: LATEST,
    })
  })

  it('rejects clock rollback without mutating the persisted lifecycle', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'paused',
      now: () => new Date(LATER),
    })
    const before = await readFile(lifecyclePath(dataDir), 'utf-8')

    await expect(setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'active',
      now: () => new Date('2026-08-01T18:59:59.999Z'),
    })).rejects.toBeInstanceOf(LocalWorkspaceProductionLifecycleRecoveryRequiredError)

    expect(await readFile(lifecyclePath(dataDir), 'utf-8')).toBe(before)
    expect(await inspectLocalWorkspaceProductionLifecycleV1({
      dataDir,
      endpointIdentity: identity(),
    })).toEqual({
      mode: 'paused',
      revision: 1,
      persisted: true,
      updatedAt: LATER,
    })
  })

  it('survives endpoint-key rotation because the lifecycle binds the stable endpoint', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    await setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'paused',
      now: () => new Date(LATER),
    })

    expect(await inspectLocalWorkspaceProductionLifecycleV1({
      dataDir,
      endpointIdentity: identity(2, 'b'.repeat(64)),
      now: () => new Date(LATEST),
    })).toEqual({
      mode: 'paused',
      revision: 1,
      persisted: true,
      updatedAt: LATER,
    })
  })

  it('fails closed on malformed or cross-bound lifecycle state', async () => {
    const dataDir = await root()
    await createWorkspace(dataDir)
    await writeFile(lifecyclePath(dataDir), '{not-json', 'utf-8')

    await expect(inspectLocalWorkspaceProductionLifecycleV1({
      dataDir,
      endpointIdentity: identity(),
    })).rejects.toBeInstanceOf(LocalWorkspaceProductionLifecycleRecoveryRequiredError)

    await writeFile(lifecyclePath(dataDir), JSON.stringify({
      kind: 'metrora.local-workspace-production-lifecycle',
      version: 1,
      workspaceId: 'workspace_99999999-0000-4000-8000-000000000999',
      endpointId: identity().endpointId,
      mode: 'paused',
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    }), 'utf-8')

    await expect(setLocalWorkspaceProductionModeV1({
      dataDir,
      endpointIdentity: identity(),
      mode: 'active',
    })).rejects.toBeInstanceOf(LocalWorkspaceProductionLifecycleRecoveryRequiredError)
  })
})
