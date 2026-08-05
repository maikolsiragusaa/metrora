import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  CACHE_VERSION,
  computeEnvFingerprint,
  fingerprintFile,
  type CachedFile,
  type SessionCache,
} from '../src/session-cache.js'
import type { SessionSource } from '../src/providers/types.js'
import {
  assessSessionSnapshotCompleteness,
  type SessionSnapshotCompleteness,
} from '../src/session-snapshot-completeness.js'

let root: string

function cachedFile(fingerprint: NonNullable<Awaited<ReturnType<typeof fingerprintFile>>>): CachedFile {
  return { fingerprint, mcpInventory: [], turns: [] }
}

function cache(): SessionCache {
  return { version: CACHE_VERSION, providers: {}, complete: true }
}

function genericSource(path: string, provider = 'zed'): SessionSource {
  return { path, project: 'project', provider }
}

function claudeSource(path: string): SessionSource {
  return {
    path,
    project: 'project',
    provider: 'claude',
    sourceId: 'claude-config:test',
    sourceLabel: 'Claude test',
    sourcePath: path,
    sourceKind: 'claude-config',
  }
}

async function expectState(
  sessionCache: SessionCache,
  sources: SessionSource[],
  expected: SessionSnapshotCompleteness,
): Promise<void> {
  await expect(assessSessionSnapshotCompleteness(sessionCache, sources)).resolves.toBe(expected)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'metrora-session-snapshot-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('generic provider read-only snapshot completeness', () => {
  it('is complete when every discovered file matches the complete cache snapshot', async () => {
    const path = join(root, 'zed.db')
    await writeFile(path, 'stable')
    const fp = await fingerprintFile(path)
    expect(fp).not.toBeNull()

    const sessionCache = cache()
    sessionCache.providers['zed'] = {
      envFingerprint: computeEnvFingerprint('zed'),
      files: { [path]: cachedFile(fp!) },
    }

    await expectState(sessionCache, [genericSource(path)], 'complete')
  })

  it('is degraded when a discovered file changed under the snapshot', async () => {
    const path = join(root, 'zed.db')
    await writeFile(path, 'before')
    const fp = await fingerprintFile(path)
    const sessionCache = cache()
    sessionCache.providers['zed'] = {
      envFingerprint: computeEnvFingerprint('zed'),
      files: { [path]: cachedFile(fp!) },
    }

    await writeFile(path, 'after-with-different-size')
    await expectState(sessionCache, [genericSource(path)], 'degraded')
  })

  it('is degraded when a newly discovered file has no cache entry', async () => {
    const oldPath = join(root, 'old.db')
    const newPath = join(root, 'new.db')
    await writeFile(oldPath, 'old')
    await writeFile(newPath, 'new')
    const fp = await fingerprintFile(oldPath)
    const sessionCache = cache()
    sessionCache.providers['zed'] = {
      envFingerprint: computeEnvFingerprint('zed'),
      files: { [oldPath]: cachedFile(fp!) },
    }

    await expectState(sessionCache, [genericSource(oldPath), genericSource(newPath)], 'degraded')
  })
})

describe('Claude read-only snapshot completeness', () => {
  it('is complete when every recursively discovered JSONL matches the snapshot', async () => {
    const project = join(root, 'projects', 'demo')
    const nested = join(project, 'subagents', 'workflows', 'wf')
    await mkdir(nested, { recursive: true })
    const parent = join(project, 'parent.jsonl')
    const child = join(nested, 'agent-child.jsonl')
    await writeFile(parent, '{}\n')
    await writeFile(child, '{}\n')

    const parentFp = await fingerprintFile(parent)
    const childFp = await fingerprintFile(child)
    const sessionCache = cache()
    sessionCache.providers['claude'] = {
      envFingerprint: computeEnvFingerprint('claude'),
      files: {
        [parent]: cachedFile(parentFp!),
        [child]: cachedFile(childFp!),
      },
    }

    await expectState(sessionCache, [claudeSource(project)], 'complete')
  })

  it('is degraded when a Claude transcript changed under the snapshot', async () => {
    const project = join(root, 'projects', 'demo')
    await mkdir(project, { recursive: true })
    const path = join(project, 'session.jsonl')
    await writeFile(path, '{}\n')
    const fp = await fingerprintFile(path)
    const sessionCache = cache()
    sessionCache.providers['claude'] = {
      envFingerprint: computeEnvFingerprint('claude'),
      files: { [path]: cachedFile(fp!) },
    }

    await writeFile(path, '{"changed":true}\n')
    await expectState(sessionCache, [claudeSource(project)], 'degraded')
  })

  it('is degraded when a new Claude transcript is missing from the snapshot', async () => {
    const project = join(root, 'projects', 'demo')
    await mkdir(project, { recursive: true })
    const oldPath = join(project, 'old.jsonl')
    const newPath = join(project, 'new.jsonl')
    await writeFile(oldPath, '{}\n')
    const oldFp = await fingerprintFile(oldPath)
    const sessionCache = cache()
    sessionCache.providers['claude'] = {
      envFingerprint: computeEnvFingerprint('claude'),
      files: { [oldPath]: cachedFile(oldFp!) },
    }

    await writeFile(newPath, '{}\n')
    await expectState(sessionCache, [claudeSource(project)], 'degraded')
  })
})

describe('snapshot authority boundaries', () => {
  it('is degraded when the session cache hydration itself is incomplete', async () => {
    const sessionCache = cache()
    sessionCache.complete = false
    await expectState(sessionCache, [], 'degraded')
  })

  it('is degraded when provider parse configuration drifted', async () => {
    const path = join(root, 'zed.db')
    await writeFile(path, 'stable')
    const fp = await fingerprintFile(path)
    const sessionCache = cache()
    sessionCache.providers['zed'] = {
      envFingerprint: 'stale-environment',
      files: { [path]: cachedFile(fp!) },
    }

    await expectState(sessionCache, [genericSource(path)], 'degraded')
  })

  it('treats a complete empty snapshot with no discovered sources as complete', async () => {
    await expectState(cache(), [], 'complete')
  })
})
