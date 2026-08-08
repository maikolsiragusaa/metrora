import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, unlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  acquireCacheRefreshLock,
  type RefreshLockClock,
} from '../src/cache-refresh-lock.js'
import { emptyCache, loadCache, saveCache, sessionCachePath } from '../src/session-cache.js'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cb-refresh-lock-'))
  dirs.push(dir)
  return dir
}

function lockPath(dir: string): string {
  return join(dir, 'session-refresh.lock')
}

function fakeClock(start = 1_000): RefreshLockClock & { advance: (ms: number) => void } {
  let wall = start
  let monotonic = start
  return {
    wallNow: () => wall,
    monotonicNow: () => monotonic,
    advance: ms => { wall += ms; monotonic += ms },
  }
}

afterEach(async () => {
  delete process.env['METRORA_CACHE_DIR']
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('warm session-cache refresh lock', () => {
  it('returns acquired and releases its own token', async () => {
    const dir = await tempDir()
    const result = await acquireCacheRefreshLock({ cacheDir: dir })
    expect(result.outcome).toBe('acquired')
    if (result.outcome !== 'acquired') return

    const record = JSON.parse(await readFile(lockPath(dir), 'utf-8'))
    expect(record).toMatchObject({ pid: process.pid, token: result.handle.token })
    expect(typeof record.at).toBe('number')
    await result.handle.release()
    await expect(stat(lockPath(dir))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports completed-by-other after a clean release', async () => {
    const dir = await tempDir()
    const path = lockPath(dir)
    await writeFile(path, JSON.stringify({ pid: 1, token: 'holder', at: Date.now() }))
    let polls = 0
    const result = await acquireCacheRefreshLock({
      cacheDir: dir,
      waitMs: 100,
      pollMs: 1,
      sleep: async () => {
        if (++polls === 1) await unlink(path)
      },
    })
    expect(result).toEqual({ outcome: 'completed-by-other' })
  })

  it('uses a monotonic deadline and times out without invalidating the holder', async () => {
    const dir = await tempDir()
    const clock = fakeClock()
    const path = lockPath(dir)
    await writeFile(path, JSON.stringify({ pid: 1, token: 'holder', at: clock.wallNow() }))
    const now = new Date(clock.wallNow())
    await utimes(path, now, now)

    const result = await acquireCacheRefreshLock({
      cacheDir: dir,
      clock,
      waitMs: 30,
      staleMs: 90,
      pollMs: 10,
      sleep: async ms => { clock.advance(ms) },
    })
    expect(result).toEqual({ outcome: 'timed-out' })
    expect(JSON.parse(await readFile(path, 'utf-8')).token).toBe('holder')
  })

  it('reports unavailable when lock infrastructure is unusable', async () => {
    const dir = await tempDir()
    const notDirectory = join(dir, 'file')
    await writeFile(notDirectory, 'x')
    expect(await acquireCacheRefreshLock({ cacheDir: notDirectory })).toEqual({ outcome: 'unavailable' })
  })

  it('serializes same-process acquisitions before touching the filesystem lock', async () => {
    const dir = await tempDir()
    const first = await acquireCacheRefreshLock({ cacheDir: dir })
    expect(first.outcome).toBe('acquired')
    if (first.outcome !== 'acquired') return

    let settled = false
    const secondPromise = acquireCacheRefreshLock({ cacheDir: dir }).then(result => {
      settled = true
      return result
    })
    await new Promise(resolvePromise => { setTimeout(resolvePromise, 20) })
    expect(settled).toBe(false)

    await first.handle.release()
    const second = await secondPromise
    expect(second.outcome).toBe('acquired')
    if (second.outcome === 'acquired') {
      expect(second.handle.token).not.toBe(first.handle.token)
      await second.handle.release()
    }
  })

  it('allows nested same-process acquisitions for independent lock directories', async () => {
    const controlDir = await tempDir()
    const workspaceDir = await tempDir()
    const control = await acquireCacheRefreshLock({ cacheDir: controlDir })
    expect(control.outcome).toBe('acquired')
    if (control.outcome !== 'acquired') return

    try {
      const workspace = await acquireCacheRefreshLock({ cacheDir: workspaceDir, waitMs: 100 })
      expect(workspace.outcome).toBe('acquired')
      if (workspace.outcome === 'acquired') await workspace.handle.release()
    } finally {
      await control.handle.release()
    }
  })

  it('does not take over a heartbeating owner', async () => {
    const dir = await tempDir()
    const path = lockPath(dir)
    await writeFile(path, JSON.stringify({ pid: 1, token: 'holder', at: Date.now() }))
    const heartbeat = setInterval(() => {
      const now = new Date()
      void utimes(path, now, now)
    }, 5)
    try {
      const result = await acquireCacheRefreshLock({ cacheDir: dir, staleMs: 20, waitMs: 60, pollMs: 5 })
      expect(result).toEqual({ outcome: 'timed-out' })
      expect(JSON.parse(await readFile(path, 'utf-8')).token).toBe('holder')
    } finally {
      clearInterval(heartbeat)
    }
  })

  it('keeps the ownership record immutable while heartbeat advances only mtime', async () => {
    const dir = await tempDir()
    const clock = fakeClock(10_000)
    const result = await acquireCacheRefreshLock({ cacheDir: dir, clock, heartbeatMs: 1 })
    expect(result.outcome).toBe('acquired')
    if (result.outcome !== 'acquired') return
    try {
      const initialRaw = await readFile(lockPath(dir), 'utf-8')
      const initial = JSON.parse(initialRaw) as { pid: number; token: string; at: number }
      const before = (await stat(lockPath(dir))).mtimeMs
      clock.advance(1_000)

      const records: Array<{ pid: number; token: string; at: number }> = []
      // A 100ms window is occasionally too short on a saturated Windows
      // worker even though the heartbeat is healthy. Keep the assertion about
      // repeated observations while allowing the filesystem scheduler room.
      const deadline = Date.now() + 250
      while (Date.now() < deadline) {
        const raw = await readFile(lockPath(dir), 'utf-8')
        records.push(JSON.parse(raw) as { pid: number; token: string; at: number })
        await new Promise(resolvePromise => { setTimeout(resolvePromise, 1) })
      }

      expect(records.length).toBeGreaterThan(5)
      expect(records.every(record =>
        record.pid === initial.pid &&
        record.token === initial.token &&
        record.at === initial.at,
      )).toBe(true)
      expect(initial).toEqual({ pid: process.pid, token: result.handle.token, at: 10_000 })
      expect((await stat(lockPath(dir))).mtimeMs).not.toBe(before)
    } finally {
      await result.handle.release()
    }
  })

  it('takes over only after re-verifying a stale token and mtime', async () => {
    const dir = await tempDir()
    const clock = fakeClock(100_000)
    const path = lockPath(dir)
    await writeFile(path, JSON.stringify({ pid: 1, token: 'stale', at: 1 }))
    const old = new Date(1)
    await utimes(path, old, old)

    const result = await acquireCacheRefreshLock({ cacheDir: dir, clock, staleMs: 90, waitMs: 100 })
    expect(result.outcome).toBe('acquired')
    if (result.outcome !== 'acquired') return
    expect(JSON.parse(await readFile(path, 'utf-8')).token).toBe(result.handle.token)
    await result.handle.release()
    await expect(stat(join(dir, 'session-refresh.lock.takeover'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reclaims an abandoned stale takeover guard', async () => {
    const dir = await tempDir()
    const clock = fakeClock(100_000)
    await writeFile(lockPath(dir), JSON.stringify({ pid: 1, token: 'stale', at: 1 }))
    await writeFile(join(dir, 'session-refresh.lock.takeover'), JSON.stringify({ pid: 2, token: 'stale-guard', at: 1 }))
    const old = new Date(1)
    await utimes(lockPath(dir), old, old)
    await utimes(join(dir, 'session-refresh.lock.takeover'), old, old)

    const result = await acquireCacheRefreshLock({ cacheDir: dir, clock, staleMs: 90, waitMs: 100 })
    expect(result.outcome).toBe('acquired')
    if (result.outcome === 'acquired') await result.handle.release()
  })

  it('fences publication and release removes only its own token', async () => {
    const dir = await tempDir()
    process.env['METRORA_CACHE_DIR'] = dir
    const original = emptyCache()
    original.complete = true
    await saveCache(original)

    const result = await acquireCacheRefreshLock({ cacheDir: dir, heartbeatMs: 60_000 })
    expect(result.outcome).toBe('acquired')
    if (result.outcome !== 'acquired') return

    await writeFile(lockPath(dir), JSON.stringify({ pid: 999, token: 'successor', at: Date.now() }))
    const changed = emptyCache()
    changed.complete = true
    changed.providers['claude'] = { envFingerprint: 'test', files: {} }
    expect(await saveCache(changed, result.handle.verifyStillOwner)).toBe(false)
    expect((await loadCache()).providers['claude']).toBeUndefined()

    await result.handle.release()
    expect(JSON.parse(await readFile(lockPath(dir), 'utf-8')).token).toBe('successor')
    expect(sessionCachePath()).toContain(dir)
  })

  // retry shields environmental fd/CPU starvation in a saturated full-suite
  // run (fs 'unavailable' makes the fence fail CLOSED, which is correct but
  // not what this test measures); the actual race fails ~6% per verify, so a
  // mutated build cannot pass any attempt.
  it('the fence never loses to its own heartbeat (in-process serialization)', { retry: 5 }, async () => {
    // Regression: verifyStillOwner and the heartbeat tick both take the
    // takeover guard; without in-process serialization the fence could observe
    // its own heartbeat's guard file and abort a legitimate publication.
    // At a 1ms heartbeat this raced ~6% of the time before the fix.
    const dir = await mkdtemp(join(tmpdir(), 'refresh-lock-'))
    const result = await acquireCacheRefreshLock({ cacheDir: dir, heartbeatMs: 1 })
    if (result.outcome !== 'acquired') throw new Error(`expected acquired, got ${result.outcome}`)
    for (let i = 0; i < 120; i++) {
      expect(await result.handle.verifyStillOwner()).toBe(true)
    }
    await result.handle.release()
    await rm(dir, { recursive: true, force: true })
  })
})
