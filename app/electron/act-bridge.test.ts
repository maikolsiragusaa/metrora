// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createHarnessActHandlers, harnessActBridgeModulePath, type HarnessActionEvent } from './act-bridge'

const event = {
  actionId: 'harness-action',
  kind: 'run-core-compatibility',
  status: 'proposed',
  model: 'qwen3:8b',
  originatingSurface: 'desktop',
  proposalDigest: 'a'.repeat(64),
  pack: { selector: 'core-v1', packId: 'core', version: '1', checks: 6, digest: 'b'.repeat(64) },
  checks: { planned: 6, completed: 0 },
  progress: { planned: 6, completed: 0 },
  cancellation: { requested: false },
  timeout: { perRequestMs: 1000, operationMs: 7000, triggered: false },
  result: null,
  evidence: null,
  failure: null,
  updatedAt: '2026-08-30T12:00:00.000Z',
} satisfies HarnessActionEvent

describe('Electron Harness ACT bridge loader', () => {
  it('resolves the staged module in dev and packaged layouts', () => {
    expect(harnessActBridgeModulePath({ isPackaged: false, appPath: 'C:/repo/app', resourcesPath: 'unused' }))
      .toBe('C:\\repo\\app\\build\\cli\\dist\\act-desktop-bridge.js')
    expect(harnessActBridgeModulePath({ isPackaged: true, appPath: 'unused', resourcesPath: 'C:/resources' }))
      .toBe('C:\\resources\\cli.asar\\dist\\act-desktop-bridge.js')
  })

  it('exposes only safe proposal/confirm/cancel/read handlers and lazy-loads once', async () => {
    const create = vi.fn(() => ({
      proposeCoreCompatibility: vi.fn(async () => event),
      approveAndExecuteCoreCompatibility: vi.fn(async () => ({ ...event, status: 'completed' as const })),
      cancelCoreCompatibility: vi.fn(async () => ({ ...event, status: 'cancelled' as const })),
      readCoreCompatibility: vi.fn(async () => null),
    }))
    const importModule = vi.fn(async () => ({ createMetroraHarnessActBridge: create }))
    const handlers = createHarnessActHandlers({
      isPackaged: false,
      appPath: 'C:/repo/app',
      resourcesPath: 'unused',
      importModule,
    })
    expect(Object.keys(handlers)).toEqual([
      'metrora:harnessProposeCoreCompatibility',
      'metrora:harnessApproveCoreCompatibility',
      'metrora:harnessCancelCoreCompatibility',
      'metrora:harnessReadCoreCompatibility',
    ])
    expect(await handlers['metrora:harnessProposeCoreCompatibility']('qwen3:8b')).toEqual({ ok: true, value: event })
    expect(await handlers['metrora:harnessReadCoreCompatibility']('harness-action')).toEqual({ ok: true, value: null })
    expect(importModule).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
  })

  it('redacts host-side error paths and credential assignments', async () => {
    const handlers = createHarnessActHandlers({
      isPackaged: false,
      appPath: 'C:/repo/app',
      resourcesPath: 'unused',
      importModule: async () => ({
        createMetroraHarnessActBridge: () => ({
          proposeCoreCompatibility: async () => { throw new Error('failed at C:\\Users\\owner\\secret token=abc123') },
          approveAndExecuteCoreCompatibility: async () => event,
          cancelCoreCompatibility: async () => null,
          readCoreCompatibility: async () => null,
        }),
      }),
    })
    const result = await handlers['metrora:harnessProposeCoreCompatibility']('qwen3:8b')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.error.message).not.toContain('C:\\Users\\owner')
      expect(result.error.message).not.toContain('token=abc123')
    }
  })
})
