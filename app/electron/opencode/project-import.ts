import { open, stat } from 'node:fs/promises'
import path from 'node:path'

export const OPENCODE_DESKTOP_GLOBAL_STORE_FILENAME = 'opencode.global.dat' as const
export const OPENCODE_DESKTOP_APP_DIRECTORY = 'ai.opencode.desktop' as const
export const OPENCODE_WEB_SERVER_STORAGE_KEY = 'opencode.global.dat:server' as const
export const OPENCODE_DESKTOP_GLOBAL_STORE_MAX_BYTES = 8 * 1024 * 1024
export const OPENCODE_WEB_SERVER_STATE_MAX_BYTES = 2 * 1024 * 1024
export const OPENCODE_MAX_IMPORTED_PROJECTS = 512
const MAX_PROJECT_PATH_LENGTH = 4_096

export type OpenCodeProject = {
  worktree: string
  expanded: boolean
}

export type OpenCodeDesktopProjectSnapshot = {
  projects: OpenCodeProject[]
  lastProject?: string
}

export type OpenCodeWebProjectMerge = {
  changed: boolean
  serialized: string | null
  importedProjects: number
}

const emptySnapshot = (): OpenCodeDesktopProjectSnapshot => ({ projects: [] })

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isWindows(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}

function projectPathKey(value: string, platform: NodeJS.Platform): string {
  if (isWindows(platform)) {
    const normalized = path.win32.normalize(value.replaceAll('/', '\\'))
    const root = path.win32.parse(normalized).root
    return (normalized === root ? normalized : normalized.replace(/[\\]+$/u, '')).toLowerCase()
  }
  const normalized = path.posix.normalize(value)
  return normalized === path.posix.parse(normalized).root ? normalized : normalized.replace(/\/+$/u, '')
}

/** Keep the stored path intact while validating it for a local project entry. */
export function normalizeOpenCodeProjectPath(value: unknown, platform = process.platform): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_PROJECT_PATH_LENGTH || trimmed.includes('\u0000')) return null
  const absolute = isWindows(platform) ? path.win32.isAbsolute(trimmed) : path.posix.isAbsolute(trimmed)
  return absolute ? trimmed : null
}

function storedProject(value: unknown, platform: NodeJS.Platform): OpenCodeProject | null {
  if (!isRecord(value) || typeof value.expanded !== 'boolean') return null
  const worktree = normalizeOpenCodeProjectPath(value.worktree, platform)
  return worktree ? { worktree, expanded: value.expanded } : null
}

function dedupeProjects(values: unknown[], platform: NodeJS.Platform): OpenCodeProject[] {
  const seen = new Set<string>()
  const result: OpenCodeProject[] = []
  for (const value of values.slice(0, OPENCODE_MAX_IMPORTED_PROJECTS)) {
    const project = storedProject(value, platform)
    if (!project) continue
    const key = projectPathKey(project.worktree, platform)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(project)
  }
  return result
}

/**
 * Parse the v1.18.27 Electron-store shape without retaining prompt history or
 * any other top-level OpenCode state. The outer `server` value is a JSON
 * string because the upstream desktop renderer writes its persisted payload
 * through the string-valued store bridge.
 */
export function parseOpenCodeDesktopGlobalStore(raw: string, platform = process.platform): OpenCodeDesktopProjectSnapshot {
  let outer: unknown
  try { outer = JSON.parse(raw) as unknown } catch { return emptySnapshot() }
  if (!isRecord(outer) || typeof outer.server !== 'string') return emptySnapshot()

  let server: unknown
  try { server = JSON.parse(outer.server) as unknown } catch { return emptySnapshot() }
  if (!isRecord(server) || !isRecord(server.projects) || !Array.isArray(server.projects.local)) return emptySnapshot()

  const projects = dedupeProjects(server.projects.local, platform)
  const lastProjectRecord = isRecord(server.lastProject) ? server.lastProject.local : undefined
  const lastProject = normalizeOpenCodeProjectPath(lastProjectRecord, platform)
  return lastProject ? { projects, lastProject } : { projects }
}

async function readBoundedText(filePath: string, maxBytes: number): Promise<string | null> {
  let initial
  try { initial = await stat(filePath) } catch { return null }
  if (!initial.isFile() || initial.size > maxBytes) return null

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'r')
    const current = await handle.stat()
    if (!current.isFile() || current.size > maxBytes) return null
    const buffer = Buffer.alloc(Math.min(Number(current.size), maxBytes + 1))
    const read = await handle.read(buffer, 0, buffer.length, 0)
    if (read.bytesRead > maxBytes) return null
    return buffer.subarray(0, read.bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

export function resolveOpenCodeDesktopGlobalStorePath(appDataPath: string): string {
  return path.join(appDataPath, OPENCODE_DESKTOP_APP_DIRECTORY, OPENCODE_DESKTOP_GLOBAL_STORE_FILENAME)
}

/** Best-effort, read-only compatibility import from the official Desktop store. */
export async function readOpenCodeDesktopProjects(filePath: string, platform = process.platform): Promise<OpenCodeDesktopProjectSnapshot> {
  const raw = await readBoundedText(filePath, OPENCODE_DESKTOP_GLOBAL_STORE_MAX_BYTES)
  return raw === null ? emptySnapshot() : parseOpenCodeDesktopGlobalStore(raw, platform)
}

function defaultWebServerState(): Record<string, unknown> {
  return { list: [], projects: {}, lastProject: {}, recentlyClosed: {} }
}

function parseWebServerState(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return defaultWebServerState()
  if (Buffer.byteLength(raw, 'utf8') > OPENCODE_WEB_SERVER_STATE_MAX_BYTES) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Merge Desktop metadata into the upstream Web `server` persistence payload. */
export function mergeOpenCodeWebProjects(
  currentRaw: string | null | undefined,
  desktop: OpenCodeDesktopProjectSnapshot,
  platform = process.platform,
): OpenCodeWebProjectMerge {
  if (desktop.projects.length === 0) return { changed: false, serialized: currentRaw ?? null, importedProjects: 0 }
  const current = parseWebServerState(currentRaw)
  if (!current) return { changed: false, serialized: currentRaw ?? null, importedProjects: 0 }

  const projects = isRecord(current.projects) ? current.projects : {}
  const existing = Array.isArray(projects.local)
    ? dedupeProjects(projects.local, platform)
    : []
  const seen = new Set(desktop.projects.map(project => projectPathKey(project.worktree, platform)))
  const local = [...desktop.projects]
  for (const project of existing) {
    if (seen.has(projectPathKey(project.worktree, platform))) continue
    seen.add(projectPathKey(project.worktree, platform))
    local.push(project)
  }

  const next: Record<string, unknown> = {
    ...current,
    projects: { ...projects, local },
  }
  if (desktop.lastProject) {
    const lastProject = isRecord(current.lastProject) ? current.lastProject : {}
    if (!Object.prototype.hasOwnProperty.call(lastProject, 'local')) {
      const importedKeys = new Set(local.map(project => projectPathKey(project.worktree, platform)))
      if (importedKeys.has(projectPathKey(desktop.lastProject, platform))) {
        next.lastProject = { ...lastProject, local: desktop.lastProject }
      }
    }
  }

  const serialized = JSON.stringify(next)
  return {
    changed: serialized !== currentRaw,
    serialized,
    importedProjects: desktop.projects.length,
  }
}
