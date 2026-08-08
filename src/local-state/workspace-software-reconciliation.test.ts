import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createLocalPersonalWorkspaceV1,
  loadLocalPersonalWorkspaceV1,
} from './local-workspace.js'
import type { LocalEndpointIdentityMetadataV1 } from './endpoint-identity.js'
import { reconcileLocalWorkspaceSoftwareV1 } from './workspace-software-reconciliation.js'

const roots: string[] = []
const CREATED = '2026-08-01T12:00:00.000Z'
const UPDATED = '2026-08-07T00:15:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-workspace-software-'))
  roots.push(value)
  return value
}

function identity(): LocalEndpointIdentityMetadataV1 {
  return {
    kind: 'metrora.local-endpoint-identity',
    version: 1,
    endpointId: 'ep_11111111-2222-4333-8444-555555555555',
    generation: 1,
    keyAlgorithm: 'ed25519',
    publicKeySpkiBase64: Buffer.from('public-key-1').toString('base64'),
    publicKeyFingerprintSha256: 'a'.repeat(64),
    eventIdentityKeyVersion: 1,
    createdAt: CREATED,
    updatedAt: CREATED,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('local Workspace software reconciliation', () => {
  it('updates stale software metadata without changing Workspace or endpoint identity', async () => {
    const dataDir = await root()
    const created = await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: {
        workspace: { displayName: 'My workspace', slug: 'my-workspace' },
        endpoint: {
          displayName: 'This computer',
          platform: { os: 'windows', architecture: 'x64' },
          metroraVersion: '0.9.19',
          collectorVersion: '0.9.19',
          capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
        },
      },
      now: () => new Date(CREATED),
      randomUUID: (() => {
        let index = 0
        return () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`
      })(),
    })

    const result = await reconcileLocalWorkspaceSoftwareV1({
      dataDir,
      endpointIdentity: identity(),
      metroraVersion: '1.0.0-rc.8',
      collectorVersion: '1.0.0-rc.8',
      now: () => new Date(UPDATED),
    })

    expect(result.outcome).toBe('updated')
    const loaded = await loadLocalPersonalWorkspaceV1({ dataDir, endpointIdentity: identity() })
    expect(loaded?.workspace).toEqual(created.state.workspace)
    expect(loaded?.ownerMembership).toEqual(created.state.ownerMembership)
    expect(loaded?.localSubjectId).toBe(created.state.localSubjectId)
    expect(loaded?.endpoint.endpointId).toBe(created.state.endpoint.endpointId)
    expect(loaded?.endpoint.identity).toEqual(created.state.endpoint.identity)
    expect(loaded?.endpointIdentityGeneration).toBe(created.state.endpointIdentityGeneration)
    expect(loaded?.endpoint.software).toEqual({
      metroraVersion: '1.0.0-rc.8',
      collectorVersion: '1.0.0-rc.8',
    })
    expect(loaded?.endpoint.updatedAt).toBe(UPDATED)
    expect(loaded?.endpoint.lastSeenAt).toBe(UPDATED)
    expect(loaded?.updatedAt).toBe(UPDATED)
  })

  it('is a no-op when the persisted software metadata is already current', async () => {
    const dataDir = await root()
    await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: {
        workspace: { displayName: 'My workspace', slug: 'my-workspace' },
        endpoint: {
          displayName: 'This computer',
          platform: { os: 'windows', architecture: 'x64' },
          metroraVersion: '1.0.0-rc.8',
          collectorVersion: '1.0.0-rc.8',
          capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
        },
      },
      now: () => new Date(CREATED),
    })

    const result = await reconcileLocalWorkspaceSoftwareV1({
      dataDir,
      endpointIdentity: identity(),
      metroraVersion: '1.0.0-rc.8',
      collectorVersion: '1.0.0-rc.8',
      now: () => new Date(UPDATED),
    })

    expect(result.outcome).toBe('unchanged')
    expect(result.state?.updatedAt).toBe(CREATED)
    expect(result.state?.endpoint.updatedAt).toBe(CREATED)
  })
})
