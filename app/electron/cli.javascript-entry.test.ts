// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { spawnSpecFor } from './cli'

describe('spawnSpecFor JavaScript CLI entries', () => {
  it('runs an external .js entry through the current runtime in Node mode', () => {
    const entry = join(process.cwd(), 'dist', 'cli.js')
    const spec = spawnSpecFor({ kind: 'external', bin: entry }, ['status', '--period', 'today'])

    expect(spec.bin).toBe(process.execPath)
    expect(spec.args).toEqual([entry, 'status', '--period', 'today'])
    expect(spec.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('still spawns a native external executable directly', () => {
    const bin = join(process.cwd(), 'metrora-native')
    const spec = spawnSpecFor({ kind: 'external', bin }, ['status'])

    expect(spec.bin).toBe(bin)
    expect(spec.args).toEqual(['status'])
    expect(spec.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
})
