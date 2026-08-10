import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'

import type { ProbeRoot, SessionSource } from './types.js'

export type AntigravityConversationRoot = {
  dir: string
  project: string
  extensions: readonly string[]
}

function conversationRoots(): readonly AntigravityConversationRoot[] {
  const home = homedir()
  return [
    { dir: join(home, '.gemini', 'antigravity', 'conversations'), project: 'antigravity', extensions: ['.pb', '.db'] },
    { dir: join(home, '.gemini', 'antigravity', 'implicit'), project: 'antigravity', extensions: ['.pb'] },
    { dir: join(home, '.gemini', 'antigravity-cli', 'conversations'), project: 'antigravity-cli', extensions: ['.pb', '.db'] },
    { dir: join(home, '.gemini', 'antigravity-cli', 'implicit'), project: 'antigravity-cli', extensions: ['.pb'] },
    { dir: join(home, '.gemini', 'antigravity-ide', 'conversations'), project: 'antigravity-ide', extensions: ['.pb', '.db'] },
    { dir: join(home, '.gemini', 'antigravity-ide', 'implicit'), project: 'antigravity-ide', extensions: ['.pb'] },
  ]
}

export function antigravityCascadeIdFromPath(path: string): string {
  return basename(path).replace(/\.(pb|db)$/i, '')
}

function isImplicitRoot(path: string): boolean {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase().endsWith('/implicit')
}

// Native cascade identity is authoritative: direct SQLite beats protobuf,
// non-implicit roots beat mirrors, and root order breaks remaining ties.
function compareSourceAuthority(
  left: { source: { path: string }; rootIndex: number },
  right: { source: { path: string }; rootIndex: number },
): number {
  const leftPath = left.source.path
  const rightPath = right.source.path
  const leftDb = leftPath.toLowerCase().endsWith('.db')
  const rightDb = rightPath.toLowerCase().endsWith('.db')
  if (leftDb !== rightDb) return leftDb ? -1 : 1

  const leftImplicit = leftPath.replace(/\\/g, '/').includes('/implicit/')
  const rightImplicit = rightPath.replace(/\\/g, '/').includes('/implicit/')
  if (leftImplicit !== rightImplicit) return leftImplicit ? 1 : -1

  return left.rootIndex - right.rootIndex
}

function isConversationFile(file: string, extensions: readonly string[]): boolean {
  const lowerFile = file.toLowerCase()
  return extensions.some(ext => lowerFile.endsWith(ext))
}

export async function discoverAntigravitySources(
  statusLinePath: string,
  roots?: readonly AntigravityConversationRoot[],
): Promise<SessionSource[]> {
  const includeStatusLineEvents = roots === undefined
  const effectiveRoots = roots ?? conversationRoots()
  const selected = new Map<string, { source: SessionSource; rootIndex: number }>()

  for (let rootIndex = 0; rootIndex < effectiveRoots.length; rootIndex++) {
    const root = effectiveRoots[rootIndex]!
    let files: string[]
    try { files = await readdir(root.dir) } catch { continue }

    for (const file of files.sort()) {
      if (!isConversationFile(file, root.extensions)) continue
      const path = join(root.dir, file)
      const sourceStat = await stat(path).catch(() => null)
      if (!sourceStat?.isFile()) continue
      const source = { path, project: root.project, provider: 'antigravity' }
      const candidate = { source, rootIndex }
      const cascadeId = antigravityCascadeIdFromPath(path)
      const prior = selected.get(cascadeId)
      if (!prior || compareSourceAuthority(candidate, prior) < 0) selected.set(cascadeId, candidate)
    }
  }

  const sources = [...selected.values()].map(candidate => candidate.source)
  if (!includeStatusLineEvents) return sources

  const statusLineStat = await stat(statusLinePath).catch(() => null)
  if (statusLineStat?.isFile()) {
    sources.push({ path: statusLinePath, project: 'antigravity-cli', provider: 'antigravity' })
  }
  return sources
}

export function antigravityProbeRoots(statusLinePath: string): ProbeRoot[] {
  return [
    ...conversationRoots().map(root => ({
      path: root.dir,
      label: isImplicitRoot(root.dir) ? 'implicit' : 'conversations',
    })),
    { path: statusLinePath, label: 'statusline' },
  ]
}
