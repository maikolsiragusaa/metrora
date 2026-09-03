import { createHash, randomUUID } from 'node:crypto'
import { access, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { HarnessWorkspace } from './harness-runtime-types.js'

export const HARNESS_WORKSPACE_STATE_VERSION = 1 as const

type WorkspaceState = { version: 1; root: string | null; displayName: string | null }

function isWindows(): boolean { return process.platform === 'win32' }
function comparisonPath(value: string): string { return isWindows() ? value.toLowerCase() : value }

function inside(root: string, candidate: string): boolean {
  const rootText = comparisonPath(path.resolve(root))
  const candidateText = comparisonPath(path.resolve(candidate))
  return candidateText === rootText || candidateText.startsWith(rootText.endsWith(path.sep) ? rootText : rootText + path.sep)
}

function workspaceId(root: string): string {
  return `workspace-${createHash('sha256').update(comparisonPath(root)).digest('hex').slice(0, 16)}`
}

function displayName(root: string): string {
  return path.basename(root) || root.split(path.sep).filter(Boolean).at(-1) || 'Workspace'
}

/** Resolve and verify an explicitly selected local directory. The caller must
 * pass a folder chosen by the user; there is deliberately no cwd fallback. */
export async function canonicalizeWorkspaceRoot(input: unknown): Promise<string> {
  if (typeof input !== 'string' || !input.trim() || input.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(input)) {
    throw new Error('Choose a valid local Workspace folder.')
  }
  const resolved = path.resolve(input.trim())
  if (!path.isAbsolute(resolved)) throw new Error('Workspace root must be an absolute local folder.')
  const stat = await lstat(resolved).catch(() => null)
  if (!stat || !stat.isDirectory()) throw new Error('The selected Workspace folder is unavailable.')
  const canonical = await realpath(resolved)
  const canonicalStat = await lstat(canonical)
  if (!canonicalStat.isDirectory()) throw new Error('The selected Workspace folder is unavailable.')
  return canonical
}

/** Validate a Workspace-relative path and resolve it only after checking both
 * lexical containment and realpath containment where the target exists. */
export async function resolveWorkspacePath(root: string, relativeOrAbsolute: unknown, options: { allowMissing?: boolean } = {}): Promise<{ absolute: string; relative: string }> {
  const canonicalRoot = await canonicalizeWorkspaceRoot(root)
  if (typeof relativeOrAbsolute !== 'string' || !relativeOrAbsolute.trim() || relativeOrAbsolute.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(relativeOrAbsolute)) {
    throw new Error('Workspace path is invalid.')
  }
  const raw = relativeOrAbsolute.trim()
  const candidate = path.resolve(canonicalRoot, raw)
  if (!inside(canonicalRoot, candidate)) throw new Error('Workspace path escapes the selected Workspace.')
  const relative = path.relative(canonicalRoot, candidate).replaceAll('\\', '/') || '.'
  if (relative === '..' || relative.startsWith('../')) throw new Error('Workspace path escapes the selected Workspace.')
  const resolvedTarget = await realpath(candidate).catch(() => null)
  if (resolvedTarget) {
    if (!inside(canonicalRoot, resolvedTarget)) throw new Error('Workspace symlink escapes the selected Workspace.')
    return { absolute: resolvedTarget, relative }
  }
  if (!options.allowMissing) throw new Error('Workspace path is unavailable.')
  const parent = await realpath(path.dirname(candidate)).catch(() => null)
  if (!parent || !inside(canonicalRoot, parent)) throw new Error('Workspace path escapes the selected Workspace.')
  return { absolute: candidate, relative }
}

export function projectWorkspace(root: string | null, available = true): HarnessWorkspace | null {
  if (!root) return null
  const canonical = path.resolve(root)
  return { id: workspaceId(canonical), displayName: displayName(canonical), relativeRoot: '.', available }
}

export class HarnessWorkspaceAuthority {
  private root: string | null = null
  private workspaceAvailable = false

  async setRoot(input: unknown): Promise<HarnessWorkspace> {
    const canonical = await canonicalizeWorkspaceRoot(input)
    this.root = canonical
    this.workspaceAvailable = true
    return projectWorkspace(canonical, true)!
  }

  clear(): void { this.root = null; this.workspaceAvailable = false }
  rootPath(): string | null { return this.root }
  current(): HarnessWorkspace | null { return projectWorkspace(this.root, this.workspaceAvailable) }

  requireRoot(): string {
    if (!this.root || !this.workspaceAvailable) throw new Error('Open a local Workspace before using coding Tools.')
    return this.root
  }

  async resolve(value: unknown, options?: { allowMissing?: boolean }): Promise<{ absolute: string; relative: string }> {
    return resolveWorkspacePath(this.requireRoot(), value, options)
  }
}

export class HarnessWorkspaceStateStore {
  private readonly file: string
  private current: WorkspaceState = { version: HARNESS_WORKSPACE_STATE_VERSION, root: null, displayName: null }

  constructor(root: string) { this.file = path.join(path.resolve(root), 'workspace.json') }
  get path(): string { return this.file }

  async load(): Promise<WorkspaceState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as Record<string, unknown>).version === 1) {
        const value = (parsed as Record<string, unknown>).root
        this.current = { version: 1, root: typeof value === 'string' && value.length <= 4_096 ? value : null, displayName: typeof (parsed as Record<string, unknown>).displayName === 'string' ? (parsed as Record<string, unknown>).displayName as string : null }
      }
    } catch { /* first run or a removed Workspace */ }
    return { ...this.current }
  }

  async save(root: string | null, name: string | null = root ? displayName(root) : null): Promise<WorkspaceState> {
    this.current = { version: 1, root, displayName: name }
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(this.current, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.file)
    return { ...this.current }
  }

  async recover(authority: HarnessWorkspaceAuthority): Promise<HarnessWorkspace | null> {
    const state = await this.load()
    if (!state.root) { authority.clear(); return null }
    try {
      await access(state.root)
      await authority.setRoot(state.root)
      return authority.current()
    } catch {
      authority.clear()
      return projectWorkspace(state.root, false)
    }
  }
}
