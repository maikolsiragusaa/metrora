import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createOpenCodeFreshnessCoordinator,
  createOpenCodeSourceChangeDetector,
  type OpenCodeFreshnessSnapshot,
  type OpenCodeSourceChangeDetector,
} from './freshness'

async function createStoreRoot(label: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `metrora-opencode-${label}-`))
}

async function createDatabase(root: string, name = 'opencode.db'): Promise<string> {
  await mkdir(root, { recursive: true })
  const databasePath = path.join(root, name)
  await writeFile(databasePath, Buffer.from('sqlite-header'))
  return databasePath
}

function detectorFor(standalone: string, owned: string, stateRoot: string) {
  return createOpenCodeSourceChangeDetector({
    statePath: path.join(stateRoot, 'opencode', 'freshness.json'),
    environment: {
      OPENCODE_DATA_DIR: standalone,
      METRORA_OPENCODE_EXTRA_DATA_DIRS: JSON.stringify([owned]),
    },
  })
}

const emptyFingerprint = { signature: 'empty', rootCount: 2, existingRootCount: 2, databaseCount: 1, elapsedMs: 0 }

describe('OpenCode automatic freshness', () => {
  let roots: string[] = []

  beforeEach(() => {
    roots = []
  })

  async function cleanup(): Promise<void> {
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  }

  it('acknowledges both standalone and Metrora-owned stores, then stays quiet without changes', async () => {
    const standalone = await createStoreRoot('standalone')
    const owned = await createStoreRoot('owned')
    const state = await createStoreRoot('state')
    roots.push(standalone, owned, state)
    const standaloneDb = await createDatabase(standalone)
    const ownedDb = await createDatabase(owned)
    const before = await readFile(standaloneDb)

    const detector = detectorFor(standalone, owned, state)
    const first = await detector.check()
    expect(first.changed).toBe(true)
    expect(first.databaseCount).toBe(2)
    expect(await detector.commit(first)).toBe(true)
    expect((await detector.check()).changed).toBe(false)
    expect(await readFile(standaloneDb)).toEqual(before)
    await appendFile(ownedDb, 'owned-write')
    expect((await detector.check()).changed).toBe(true)

    await cleanup()
  })

  it('detects main-file writes, WAL growth, checkpoint removal, and replacement', async () => {
    const standalone = await createStoreRoot('wal')
    const owned = await createStoreRoot('owned')
    const state = await createStoreRoot('state')
    roots.push(standalone, owned, state)
    const databasePath = await createDatabase(standalone)
    const detector = detectorFor(standalone, owned, state)

    let snapshot = await detector.check()
    expect(await detector.commit(snapshot)).toBe(true)
    await appendFile(databasePath, 'main-write')
    expect((await detector.check()).changed).toBe(true)

    snapshot = await detector.check()
    expect(await detector.commit(snapshot)).toBe(true)
    await writeFile(`${databasePath}-wal`, 'wal-write')
    expect((await detector.check()).changed).toBe(true)

    snapshot = await detector.check()
    expect(await detector.commit(snapshot)).toBe(true)
    await rm(`${databasePath}-wal`)
    await appendFile(databasePath, 'checkpoint')
    expect((await detector.check()).changed).toBe(true)

    snapshot = await detector.check()
    expect(await detector.commit(snapshot)).toBe(true)
    await rm(databasePath)
    await createDatabase(standalone)
    expect((await detector.check()).changed).toBe(true)

    await cleanup()
  })

  it('detects a store appearing after startup', async () => {
    const standalone = await createStoreRoot('appears')
    const owned = path.join(await createStoreRoot('owned-parent'), 'db')
    const state = await createStoreRoot('state')
    roots.push(standalone, path.dirname(owned), state)
    const detector = detectorFor(standalone, owned, state)

    expect((await detector.check()).changed).toBe(false)
    await createDatabase(owned)
    expect((await detector.check()).changed).toBe(true)

    await cleanup()
  })
})

function fakeDetector(initialChanged = true): OpenCodeSourceChangeDetector & { changed: boolean } {
  const fake = {
    changed: initialChanged,
    check: vi.fn(async (): Promise<OpenCodeFreshnessSnapshot> => ({ ...emptyFingerprint, changed: fake.changed })),
    commit: vi.fn(async () => {
      fake.changed = false
      return true
    }),
  }
  return fake
}

describe('OpenCode freshness coordinator', () => {
  it('does not launch a fresh read when the source fingerprint is unchanged', async () => {
    const detector = fakeDetector(false)
    const reconcile = vi.fn(async () => undefined)
    const coordinator = createOpenCodeFreshnessCoordinator({ detector, reconcile })

    await coordinator.onSnapshotPoll()
    await coordinator.waitForIdle()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('keeps rapid snapshot polls single-flight and does not block on reconciliation', async () => {
    const detector = fakeDetector()
    let release!: () => void
    const reconcile = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const coordinator = createOpenCodeFreshnessCoordinator({ detector, reconcile })

    await coordinator.onSnapshotPoll()
    await coordinator.onSnapshotPoll()
    expect(reconcile).toHaveBeenCalledOnce()

    release()
    await coordinator.waitForIdle()
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('runs one bounded follow-up when a source changes during reconciliation', async () => {
    const detector = fakeDetector()
    let commitCount = 0
    detector.commit = vi.fn(async () => {
      commitCount += 1
      if (commitCount === 1) return false
      detector.changed = false
      return true
    })
    const reconcile = vi.fn(async () => undefined)
    const coordinator = createOpenCodeFreshnessCoordinator({ detector, reconcile })

    await coordinator.onSnapshotPoll()
    await coordinator.waitForIdle()
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(detector.commit).toHaveBeenCalledTimes(2)
  })

  it('acknowledges explicit OpenCode/all fresh reads but ignores unrelated providers', async () => {
    const detector = fakeDetector(false)
    const coordinator = createOpenCodeFreshnessCoordinator({ detector, reconcile: vi.fn() })

    await coordinator.onExplicitFreshSuccess('claude')
    expect(detector.commit).not.toHaveBeenCalled()
    await coordinator.onExplicitFreshSuccess('opencode')
    expect(detector.commit).toHaveBeenCalledOnce()
    await coordinator.onExplicitFreshSuccess('all')
    expect(detector.commit).toHaveBeenCalledTimes(2)
  })
})
