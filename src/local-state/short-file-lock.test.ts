import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withShortFileLock } from './short-file-lock.js'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'qovrion-short-lock-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.sequential('short file lock', () => {
  it('serializes concurrent in-process transactions', async () => {
    const directory = await root()
    const lock = join(directory, 'state.lock')
    const order: string[] = []
    const first = withShortFileLock(lock, async () => {
      order.push('first-start')
      await new Promise(resolve => { setTimeout(resolve, 20) })
      order.push('first-end')
    })
    const second = withShortFileLock(lock, async () => {
      order.push('second-start')
      order.push('second-end')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  it('takes over a stable stale lock left by a crashed process', async () => {
    const directory = await root()
    await mkdir(directory, { recursive: true })
    const lock = join(directory, 'state.lock')
    await writeFile(lock, JSON.stringify({ token: 'a'.repeat(32), pid: 123, createdAt: 'old' }))
    const old = new Date(Date.now() - 60_000)
    await utimes(lock, old, old)

    const result = await withShortFileLock(lock, async () => 'recovered', {
      staleMs: 1_000,
      waitMs: 2_000,
      pollMs: 5,
    })
    expect(result).toBe('recovered')
  })
})
