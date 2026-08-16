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
    expect(args).toHaveLength(8)
    expect(typeof args?.[5]).toBe('function')
    expect(typeof args?.[6]).toBe('function')
    expect(typeof args?.[7]).toBe('function')
  })
})
