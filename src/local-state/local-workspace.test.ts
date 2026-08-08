import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createLocalPersonalWorkspaceV1,
  loadLocalPersonalWorkspaceV1,
  LocalWorkspaceRecoveryRequiredError,
  type CreateLocalPersonalWorkspaceIntentV1,
} from './local-workspace.js'
import {
  loadOrCreateLocalEndpointIdentityV1,
  type LocalEndpointIdentityMetadataV1,
} from './endpoint-identity.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

const roots: string[] = []
const NOW = '2026-08-01T12:00:00.000Z'
const LATER = '2026-08-01T13:00:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-local-workspace-'))
  roots.push(value)
  return value
}

function identity(
  generation = 1,
  fingerprint = 'a'.repeat(64),
  endpointId = 'ep_11111111-2222-4333-8444-555555555555',
): LocalEndpointIdentityMetadataV1 {
  return {
    kind: 'metrora.local-endpoint-identity',
    version: 1,
    endpointId,
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

function intent(overrides: Partial<CreateLocalPersonalWorkspaceIntentV1> = {}): CreateLocalPersonalWorkspaceIntentV1 {
  return {
    workspace: {
      displayName: 'Maikol Workspace',
      slug: 'maikol-workspace',
      ...overrides.workspace,
    },
    endpoint: {
      displayName: 'Windows workstation',
      platform: { os: 'windows', architecture: 'x64' },
      metroraVersion: '0.9.19',
      collectorVersion: '0.9.19',
      capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
      ...overrides.endpoint,
    },
  }
}

function uuidSource(): { next: () => string; count: () => number } {
  let index = 0
  return {
    next: () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`,
    count: () => index,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('local personal workspace v1', () => {
  it('keeps load non-creating and creates one contract-valid personal workspace explicitly', async () => {
    const dataDir = await root()
    expect(await loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
    })).toBeUndefined()

    const uuids = uuidSource()
    const created = await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: intent(),
      now: () => new Date(NOW),
      randomUUID: uuids.next,
    })

    expect(created.outcome).toBe('created')
    expect(uuids.count()).toBe(3)
    expect(created.state).toMatchObject({
      kind: 'metrora.local-personal-workspace-state',
      version: 1,
      localSubjectId: 'subject_00000000-0000-4000-8000-000000000003',
      endpointIdentityGeneration: 1,
      workspace: {
        kind: 'metrora.workspace',
        workspaceId: 'workspace_00000000-0000-4000-8000-000000000001',
        displayName: 'Maikol Workspace',
        slug: 'maikol-workspace',
        ownership: 'personal',
        status: 'active',
      },
      ownerMembership: {
        kind: 'metrora.workspace-membership',
        membershipId: 'membership_00000000-0000-4000-8000-000000000002',
        principal: {
          type: 'user',
          principalId: 'subject_00000000-0000-4000-8000-000000000003',
        },
        role: 'owner',
        status: 'active',
      },
      endpoint: {
        kind: 'metrora.endpoint',
        endpointId: identity().endpointId,
        endpointType: 'desktop',
        identity: {
          keyAlgorithm: 'ed25519',
          publicKeyFingerprintSha256: 'a'.repeat(64),
        },
        software: {
          metroraVersion: '0.9.19',
          collectorVersion: '0.9.19',
        },
        enrollment: {
          state: 'active',
          requestedAt: NOW,
          enrolledAt: NOW,
        },
      },
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(created.state.ownerMembership.workspaceId).toBe(created.state.workspace.workspaceId)
    expect(created.state.endpoint.workspaceId).toBe(created.state.workspace.workspaceId)

    const loaded = await loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
    })
    expect(loaded).toEqual(created.state)
  })

  it('is idempotent and never overwrites an existing workspace with a later create request', async () => {
    const dataDir = await root()
    const uuids = uuidSource()
    const first = await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: intent(),
      now: () => new Date(NOW),
      randomUUID: uuids.next,
    })
    const second = await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: intent({ workspace: { displayName: 'Different request', slug: 'different-request' } }),
      now: () => new Date(LATER),
      randomUUID: uuids.next,
    })

    expect(second.outcome).toBe('existing')
    expect(second.state).toEqual(first.state)
    expect(second.state.workspace.displayName).toBe('Maikol Workspace')
    expect(uuids.count()).toBe(3)
  })

  it('serializes concurrent creation into one workspace, membership, and local subject', async () => {
    const dataDir = await root()
    const uuids = uuidSource()
    const results = await Promise.all(Array.from({ length: 8 }, () => createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: intent(),
      now: () => new Date(NOW),
      randomUUID: uuids.next,
    })))

    expect(results.filter(result => result.outcome === 'created')).toHaveLength(1)
    expect(new Set(results.map(result => result.state.workspace.workspaceId)).size).toBe(1)
    expect(new Set(results.map(result => result.state.ownerMembership.membershipId)).size).toBe(1)
    expect(new Set(results.map(result => result.state.localSubjectId)).size).toBe(1)
    expect(uuids.count()).toBe(3)
  })

  it('reuses the real protected endpoint identity without copying private key material', async () => {
    const dataDir = await root()
    const endpointIdentity = await loadOrCreateLocalEndpointIdentityV1({
      dataDir,
      protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 7)),
      now: () => new Date(NOW),
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      randomBytes: size => Buffer.alloc(size, 9),
    })

    const result = await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: endpointIdentity.metadata,
      intent: intent(),
      now: () => new Date(NOW),
      randomUUID: uuidSource().next,
    })

    expect(result.state.endpoint.endpointId).toBe(endpointIdentity.metadata.endpointId)
    expect(result.state.endpoint.identity.publicKeyFingerprintSha256)
      .toBe(endpointIdentity.metadata.publicKeyFingerprintSha256)

    const workspaceText = await readFile(
      join(dataDir, 'workspace', 'local-personal-workspace.v1.json'),
      'utf-8',
    )
    expect(workspaceText).not.toContain('privateKeyPkcs8')
    expect(workspaceText).not.toContain('eventIdentityKey')
    expect(workspaceText).not.toContain(endpointIdentity.metadata.publicKeySpkiBase64)
  })

  it('reconciles a forward endpoint-key rotation without replacing workspace identity', async () => {
    const dataDir = await root()
    const created = await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(1, 'a'.repeat(64)),
      intent: intent(),
      now: () => new Date(NOW),
      randomUUID: uuidSource().next,
    })

    const reconciled = await loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(2, 'b'.repeat(64)),
      now: () => new Date(LATER),
    })

    expect(reconciled).toBeDefined()
    expect(reconciled!.workspace.workspaceId).toBe(created.state.workspace.workspaceId)
    expect(reconciled!.ownerMembership).toEqual(created.state.ownerMembership)
    expect(reconciled!.endpoint.endpointId).toBe(created.state.endpoint.endpointId)
    expect(reconciled!.endpointIdentityGeneration).toBe(2)
    expect(reconciled!.endpoint.identity.publicKeyFingerprintSha256).toBe('b'.repeat(64))
    expect(reconciled!.endpoint.updatedAt).toBe(LATER)
    expect(reconciled!.endpoint.lastSeenAt).toBe(LATER)
    expect(reconciled!.updatedAt).toBe(LATER)
  })

  it('fails closed for a foreign, older, or contradictory endpoint identity', async () => {
    const dataDir = await root()
    await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(1),
      intent: intent(),
      now: () => new Date(NOW),
      randomUUID: uuidSource().next,
    })

    await expect(loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(1, 'a'.repeat(64), 'ep_foreign'),
    })).rejects.toBeInstanceOf(LocalWorkspaceRecoveryRequiredError)

    await expect(loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(1, 'c'.repeat(64)),
    })).rejects.toThrow(/fingerprint/)

    await loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(2, 'b'.repeat(64)),
      now: () => new Date(LATER),
    })
    await expect(loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(1, 'a'.repeat(64)),
    })).rejects.toThrow(/newer endpoint identity generation/)
  })

  it('rejects corrupted and cross-linked state instead of treating it as absent', async () => {
    const dataDir = await root()
    const created = await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: intent(),
      now: () => new Date(NOW),
      randomUUID: uuidSource().next,
    })
    const statePath = join(dataDir, 'workspace', 'local-personal-workspace.v1.json')

    await writeFile(statePath, JSON.stringify({
      ...created.state,
      ownerMembership: {
        ...created.state.ownerMembership,
        workspaceId: 'workspace_other',
      },
    }))
    await expect(loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
    })).rejects.toThrow(/membership must belong/)

    await writeFile(statePath, '{broken-json')
    await expect(loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
    })).rejects.toBeInstanceOf(LocalWorkspaceRecoveryRequiredError)
  })

  it('validates creation input before publishing any state', async () => {
    const dataDir = await root()
    await expect(createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
      intent: {
        ...intent(),
        endpoint: {
          ...intent().endpoint,
          capabilities: ['collect', 'collect'],
        },
      },
    })).rejects.toThrow(/capabilities must be unique/)

    await expect(loadLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: identity(),
    })).resolves.toBeUndefined()
  })
})
