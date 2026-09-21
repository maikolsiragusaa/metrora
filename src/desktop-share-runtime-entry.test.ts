// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  constructorArgs: [] as unknown[][],
}))

vi.mock('./sharing/share-controller.js', () => ({
  ShareController: class {
    constructor(...args: unknown[]) {
      mocks.constructorArgs.push(args)
    }

    async start(_always: boolean): Promise<void> {}
    async stop(): Promise<void> {}
    async status(): Promise<Record<string, unknown>> { return {} }
    resolvePending(_id: string, _approve: boolean): boolean { return true }
  },
}))

describe('desktop Activity share runtime', () => {
  beforeEach(() => {
    mocks.constructorArgs.length = 0
    vi.stubEnv('METRORA_CONFIG_DIR', join(tmpdir(), 'metrora-activity-runtime-test'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('passes all bounded Activity projections through the Electron runtime', async () => {
    const { createDesktopShareRuntime } = await import('./desktop-share-runtime-entry.js')

    await createDesktopShareRuntime(7777)

    const args = mocks.constructorArgs[0]
    expect(args).toHaveLength(9)
    expect(typeof args?.[5]).toBe('function')
    expect(typeof args?.[6]).toBe('function')
    expect(typeof args?.[7]).toBe('function')
    expect(args?.[8]).toBeUndefined()
  })

  it('passes the Desktop Capacity authority as the final bounded callback', async () => {
    const getCapacity = async () => []
    const { createDesktopShareRuntime } = await import('./desktop-share-runtime-entry.js')

    await createDesktopShareRuntime(7777, { getCapacity })

    expect(typeof mocks.constructorArgs[0]?.[8]).toBe('function')
  })

  it('exposes the canonical capability matrix read-only without starting sharing', async () => {
    const { createDesktopShareRuntime } = await import('./desktop-share-runtime-entry.js')
    const { buildCompanionCapabilities } = await import('./sharing/share-run.js')

    const withoutCapacity = await createDesktopShareRuntime(7777)
    const expectedWithout = await buildCompanionCapabilities(false)
    expect(await withoutCapacity.capabilities()).toEqual(expectedWithout)
    expect(withoutCapacity.capabilities && typeof withoutCapacity.capabilities === 'function').toBe(true)

    const withCapacity = await createDesktopShareRuntime(7777, { getCapacity: async () => [] })
    const expectedWith = await buildCompanionCapabilities(true)
    expect(await withCapacity.capabilities()).toEqual(expectedWith)

    const matrix = await withCapacity.capabilities()
    expect(matrix.kind).toBe('metrora.companion.capabilities')
    expect(matrix.version).toBe(1)
    expect(matrix.capabilities.find(entry => entry.id === 'home.capacity')?.availability).toBe('available')
    const noCapacityMatrix = await withoutCapacity.capabilities()
    expect(noCapacityMatrix.capabilities.find(entry => entry.id === 'home.capacity')?.availability).toBe('unavailable')
    const workspace = matrix.capabilities.find(entry => entry.id === 'workspace')
    expect(workspace?.availability).toBe('unavailable')
    expect(workspace?.reason).toBe('no-authority')
    expect(JSON.stringify(matrix)).not.toMatch(/token|fingerprint|secret|private|bearer|certificate/i)
  })
})
