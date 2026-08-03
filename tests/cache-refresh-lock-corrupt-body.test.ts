import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { acquireCacheRefreshLock } from '../src/cache-refresh-lock.js'

const roots: string[] = []

async function tempCase(prefix: string): Promise<{ root: string; cacheDir: string; barriers: string; lockPath: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  const cacheDir = join(root, 'cache')
  const barriers = join(root, 'barriers')
  await mkdir(cacheDir, { recursive: true })
  await mkdir(barriers, { recursive: true })
  return { root, cacheDir, barriers, lockPath: join(cacheDir, 'session-refresh.lock') }
}

function contender(cacheDir: string, barriers: string, id: string): ChildProcess {
  return spawn(process.execPath, [
    '--import',
    'tsx',
    join(process.cwd(), 'tests/fixtures/cache-refresh-corrupt-contender.ts'),
    cacheDir,
    barriers,
    id,
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

async function waitForOutcome(barriers: string, id: string, timeoutMs = 5_000): Promise<string> {
  const outcomes = ['acquired', 'completed-by-other', 'timed-out', 'unavailable']
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const outcome of outcomes) {
      if (existsSync(join(barriers, `${id}.${outcome}`))) return outcome
    }
    await new Promise(resolve => { setTimeout(resolve, 5) })
  }
  throw new Error(`timed out waiting for ${id} outcome`)
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return child.exitCode === 0
    ? Promise.resolve()
    : Promise.reject(new Error(`worker exited ${child.exitCode}`))
  return new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error(`worker exited ${code}: ${stderr}`)))
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('corrupt warm-refresh lock recovery', () => {
  it.each([
    ['empty body', ''],
    ['truncated JSON', '{"pid":1,"token":"abandoned"'],
    ['stable wrong-shape JSON', JSON.stringify({ version: 2, owner: 'abandoned' })],
  ])('recovers a genuinely stale %s through the normal staleness gate', async (_name, body) => {
    const { cacheDir, lockPath } = await tempCase('metrora-refresh-corrupt-stale-')
    await writeFile(lockPath, body)
    await utimes(lockPath, new Date(1), new Date(1))

    const result = await acquireCacheRefreshLock({
      cacheDir,
      staleMs: 90,
      waitMs: 250,
      pollMs: 5,
    })

    expect(result.outcome).toBe('acquired')
    if (result.outcome !== 'acquired') return
    expect(JSON.parse(await readFile(lockPath, 'utf-8')).token).toBe(result.handle.token)
    await result.handle.release()
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never takes over a fresh corrupt body whose live owner keeps heartbeating', async () => {
    const { cacheDir, lockPath } = await tempCase('metrora-refresh-corrupt-live-')
    await writeFile(lockPath, '')
    const heartbeat = setInterval(() => {
      const now = new Date()
      void utimes(lockPath, now, now)
    }, 5)

    try {
      const result = await acquireCacheRefreshLock({
        cacheDir,
        staleMs: 40,
        waitMs: 120,
        pollMs: 5,
      })
      expect(result).toEqual({ outcome: 'timed-out' })
      expect(await readFile(lockPath, 'utf-8')).toBe('')
    } finally {
      clearInterval(heartbeat)
    }
  })

  it('gives exactly one process ownership of a genuinely stale corrupt lock', async () => {
    const { cacheDir, barriers, lockPath } = await tempCase('metrora-refresh-corrupt-process-')
    await writeFile(lockPath, '')
    await utimes(lockPath, new Date(1), new Date(1))

    const a = contender(cacheDir, barriers, 'a')
    const b = contender(cacheDir, barriers, 'b')
    try {
      const [aOutcome, bOutcome] = await Promise.all([
        waitForOutcome(barriers, 'a'),
        waitForOutcome(barriers, 'b'),
      ])
      expect([aOutcome, bOutcome].sort()).toEqual(['acquired', 'timed-out'])

      const winner = aOutcome === 'acquired' ? 'a' : 'b'
      await writeFile(join(barriers, `${winner}.release`), '')
      await Promise.all([waitForExit(a), waitForExit(b)])
      await expect(stat(join(cacheDir, 'session-refresh.lock.takeover'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (a.exitCode === null) a.kill()
      if (b.exitCode === null) b.kill()
    }
  })
})
