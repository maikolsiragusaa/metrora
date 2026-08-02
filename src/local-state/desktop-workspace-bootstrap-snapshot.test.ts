import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDesktopWorkspaceBootstrapSnapshotV1 } from './desktop-workspace-bootstrap-snapshot.js'
import { loadOrCreateLocalEndpointIdentityV1 } from './endpoint-identity.js'
import { createLocalPersonalWorkspaceV1 } from './local-workspace.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'

const roots: string[] = []
const NOW = '2026-08-02T06:30:00.000Z'

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-bootstrap-snapshot-'))
  roots.push(value)
  return value
}

async function identity(dataDir: string) {
  return loadOrCreateLocalEndpointIdentityV1({
    dataDir,
    protector: new Aes256GcmSecretProtector(Buffer.alloc(32, 7)),
    now: () => new Date(NOW),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    randomBytes: size => Buffer.alloc(size, 9),
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('desktop Workspace bootstrap snapshot', () => {
  it('returns workspace-required without inspecting evidence', async () => {
    const dataDir = await root()
    const endpoint = await identity(dataDir)

    await expect(createDesktopWorkspaceBootstrapSnapshotV1({
      dataDir,
      identity: endpoint,
      now: () => new Date(NOW),
    })).resolves.toMatchObject({
      workspace: null,
      productionLifecycle: null,
      evidence: { state: 'workspace-required' },
    })
    endpoint.privateKeyPkcs8.fill(0)
    endpoint.eventIdentityKey.fill(0)
  })

  it('renders protected identity and lifecycle without enumerating malformed outbox state', async () => {
    const dataDir = await root()
    const endpoint = await identity(dataDir)
    await createLocalPersonalWorkspaceV1({
      dataDir,
      endpointIdentity: endpoint.metadata,
      now: () => new Date(NOW),
      randomUUID: (() => {
        let index = 0
        return () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`
      })(),
      intent: {
        workspace: { displayName: 'My workspace', slug: 'my-workspace' },
        endpoint: {
          displayName: 'This computer',
          platform: { os: 'windows', architecture: 'x64' },
          metroraVersion: '0.9.20',
          collectorVersion: '0.9.20',
          capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
        },
      },
    })

    const events = join(dataDir, 'outbox', 'v1', 'events')
    await mkdir(events, { recursive: true })
    await writeFile(join(events, `${'a'.repeat(64)}.json`), '{ malformed and intentionally unread }')

    const snapshot = await createDesktopWorkspaceBootstrapSnapshotV1({
      dataDir,
      identity: endpoint,
      now: () => new Date(NOW),
    })

    expect(snapshot).toMatchObject({
      workspace: {
        displayName: 'My workspace',
        endpoint: { displayName: 'This computer', os: 'windows' },
      },
      productionLifecycle: { mode: 'active', revision: 0, persisted: false },
      evidence: {
        state: 'blocked',
        pendingEventCount: 0,
        invalidEventCount: 0,
      },
    })
    expect(snapshot.evidence.blockers).toEqual([
      expect.stringMatching(/inspection is pending/i),
    ])
    expect(JSON.stringify(snapshot)).not.toContain(events)
    endpoint.privateKeyPkcs8.fill(0)
    endpoint.eventIdentityKey.fill(0)
  })
})
