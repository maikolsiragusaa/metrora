import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createMetroraHarnessActBridge } from '../src/act/desktop-bridge.js'
import { TrustedActionAuthorityV1 } from '../src/act/action-contract-v1.js'

const roots: string[] = []
const now = () => new Date('2026-08-30T12:00:00.000Z')

afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }) })

describe('Harness trusted desktop ACT bridge', () => {
  it('persists a safe proposal and never returns the contract or approval token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'metrora-harness-bridge-'))
    roots.push(root)
    const events: unknown[] = []
    const bridge = createMetroraHarnessActBridge({
      actionsDir: join(root, 'actions'),
      dataDir: join(root, 'data'),
      now,
      authority: new TrustedActionAuthorityV1({ secret: new Uint8Array(32).fill(5), now }),
      emit: event => events.push(event),
    })
    const proposal = await bridge.proposeCoreCompatibility('qwen3:8b')
    expect(proposal).toMatchObject({
      kind: 'run-core-compatibility',
      status: 'proposed',
      model: 'qwen3:8b',
      originatingSurface: 'desktop',
      runtime: { id: 'ollama-local' },
      pack: { selector: 'core-v1', checks: 6 },
      checks: { planned: 6, completed: 0 },
      progress: { planned: 6, completed: 0 },
      result: null,
      evidence: null,
      failure: null,
    })
    expect(proposal).not.toHaveProperty('contract')
    expect(proposal).not.toHaveProperty('approval')
    expect(events).toHaveLength(1)
    const persisted = await bridge.readCoreCompatibility(proposal.actionId)
    expect(persisted).toMatchObject({ actionId: proposal.actionId, status: 'proposed' })
    expect(persisted).not.toHaveProperty('contract')
    expect(persisted).not.toHaveProperty('approval')
  })

  it('rejects a changed digest and cancels an unconfirmed proposal through ACT', async () => {
    const root = await mkdtemp(join(tmpdir(), 'metrora-harness-bridge-'))
    roots.push(root)
    const bridge = createMetroraHarnessActBridge({ actionsDir: join(root, 'actions'), now })
    const proposal = await bridge.proposeCoreCompatibility('qwen3:8b')
    await expect(bridge.approveAndExecuteCoreCompatibility({ actionId: proposal.actionId, proposalDigest: '0'.repeat(64) })).rejects.toThrow('proposal changed')
    const cancelled = await bridge.cancelCoreCompatibility(proposal.actionId)
    expect(cancelled).toMatchObject({ actionId: proposal.actionId, status: 'cancelled', cancellation: { requested: true } })
  })

  it('fails closed for llama-server because the canonical pack has Ollama-only semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'metrora-harness-bridge-target-'))
    roots.push(root)
    const bridge = createMetroraHarnessActBridge({ actionsDir: join(root, 'actions'), now })
    await expect(bridge.proposeCoreCompatibility('fixture-model', 'llama-server')).rejects.toThrow(/Ollama.*llama-server/u)
  })
})
