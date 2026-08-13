import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { ProbeRoot, SessionSource } from './types.js'

async function collectRollouts(root: string, out: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      await collectRollouts(path, out)
    } else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      out.push(path)
    }
  }
}

/**
 * Codex freshness only needs the candidate path set. Full discovery still
 * validates the first line and resolves project metadata when a candidate is
 * not already present in the persisted authority manifest.
 */
export async function discoverCodexSessionPathsForFreshness(
  roots: readonly ProbeRoot[],
): Promise<SessionSource[]> {
  const paths: string[] = []
  for (const root of roots) await collectRollouts(root.path, paths)
  const seen = new Set<string>()
  return paths
    .filter(path => {
      const name = basename(path)
      if (seen.has(name)) return false
      seen.add(name)
      return true
    })
    .map(path => ({ path, project: '', provider: 'codex' }))
}
