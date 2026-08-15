import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getConfigFilePath } from './config.js'

/** The persisted overlay above collector-owned Source Projects. */
export const METRORA_PROJECT_REGISTRY_KIND = 'metrora.project-registry' as const
export const METRORA_PROJECT_REGISTRY_VERSION = 1 as const

export const METRORA_PROJECT_ICONS = ['grid', 'spark', 'orbit', 'stack', 'terminal', 'branch'] as const
export type MetroraProjectIcon = typeof METRORA_PROJECT_ICONS[number]

export const METRORA_PROJECT_COLORS = ['cyan', 'blue', 'violet', 'amber', 'green', 'coral'] as const
export type MetroraProjectColor = typeof METRORA_PROJECT_COLORS[number]

export type MetroraProject = {
  /** Stable user-project identity. It is never derived from the display name. */
  id: string
  name: string
  icon: MetroraProjectIcon
  color: MetroraProjectColor
  /** Stable Source Project ids; names and paths are deliberately not keys. */
  sourceProjectMembership: string[]
  createdAt: string
  updatedAt: string
}

export type ProjectRegistry = {
  kind: typeof METRORA_PROJECT_REGISTRY_KIND
  version: typeof METRORA_PROJECT_REGISTRY_VERSION
  projects: MetroraProject[]
}

export type ProjectRegistryReadStatus = 'missing' | 'valid' | 'migrated' | 'corrupt'

export type ProjectRegistryReadResult = {
  registry: ProjectRegistry
  status: ProjectRegistryReadStatus
  /** The invalid registry is never returned to callers as usable data. */
  error?: string
}

export type ProjectPresentationPatch = {
  name?: string
  icon?: MetroraProjectIcon
  color?: MetroraProjectColor
}

export class ProjectRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectRegistryError'
  }
}

const DEFAULT_REGISTRY: ProjectRegistry = {
  kind: METRORA_PROJECT_REGISTRY_KIND,
  version: METRORA_PROJECT_REGISTRY_VERSION,
  projects: [],
}

export function projectRegistryPath(): string {
  return join(dirname(getConfigFilePath()), 'projects.v1.json')
}

export function emptyProjectRegistry(): ProjectRegistry {
  return { ...DEFAULT_REGISTRY, projects: [] }
}

function cloneRegistry(registry: ProjectRegistry): ProjectRegistry {
  return {
    ...registry,
    projects: registry.projects.map(project => ({
      ...project,
      sourceProjectMembership: [...project.sourceProjectMembership],
    })),
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^mp_[a-z0-9_-]{16,80}$/i.test(value)
}

function validSourceId(value: unknown): value is string {
  return typeof value === 'string' && /^sp_[a-f0-9]{64}$/.test(value)
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizedName(value: unknown): string {
  if (typeof value !== 'string') throw new ProjectRegistryError('project name must be a string')
  const name = value.trim()
  if (name.length === 0 || name.length > 120) throw new ProjectRegistryError('project name is invalid')
  return name
}

function icon(value: unknown): MetroraProjectIcon {
  if (typeof value !== 'string' || !(METRORA_PROJECT_ICONS as readonly string[]).includes(value)) {
    throw new ProjectRegistryError('project icon is invalid')
  }
  return value as MetroraProjectIcon
}

function color(value: unknown): MetroraProjectColor {
  if (typeof value !== 'string' || !(METRORA_PROJECT_COLORS as readonly string[]).includes(value)) {
    throw new ProjectRegistryError('project color is invalid')
  }
  return value as MetroraProjectColor
}

function normalizedProject(value: unknown): MetroraProject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectRegistryError('project entry is invalid')
  }
  const entry = value as Record<string, unknown>
  if (!validId(entry.id)) throw new ProjectRegistryError('project id is invalid')
  if (!Array.isArray(entry.sourceProjectMembership)) throw new ProjectRegistryError('project membership is invalid')
  const membership = entry.sourceProjectMembership.map(value => {
    if (!validSourceId(value)) throw new ProjectRegistryError('source project id is invalid')
    return value
  })
  if (new Set(membership).size !== membership.length) throw new ProjectRegistryError('project membership contains duplicates')
  if (!validIso(entry.createdAt) || !validIso(entry.updatedAt)) throw new ProjectRegistryError('project timestamps are invalid')
  return {
    id: entry.id,
    name: normalizedName(entry.name),
    icon: icon(entry.icon),
    color: color(entry.color),
    sourceProjectMembership: membership,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
  }
}

function validateRegistry(value: unknown): ProjectRegistry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectRegistryError('project registry envelope is invalid')
  }
  const envelope = value as Record<string, unknown>
  if (envelope.kind !== METRORA_PROJECT_REGISTRY_KIND || envelope.version !== METRORA_PROJECT_REGISTRY_VERSION) {
    throw new ProjectRegistryError('project registry version is unsupported')
  }
  if (!Array.isArray(envelope.projects)) throw new ProjectRegistryError('project registry projects are invalid')
  const projects = envelope.projects.map(normalizedProject)
  const ids = new Set<string>()
  const memberships = new Set<string>()
  for (const project of projects) {
    if (ids.has(project.id)) throw new ProjectRegistryError('project ids are not unique')
    ids.add(project.id)
    for (const sourceId of project.sourceProjectMembership) {
      if (memberships.has(sourceId)) throw new ProjectRegistryError('a source project has multiple memberships')
      memberships.add(sourceId)
    }
  }
  return { kind: METRORA_PROJECT_REGISTRY_KIND, version: METRORA_PROJECT_REGISTRY_VERSION, projects }
}

function deterministicMigratedId(index: number, name: string, membership: string[]): string {
  const digest = createHash('sha256')
    .update(`metrora-project-migration:${index}:${name}:${membership.join(',')}`)
    .digest('hex')
  return `mp_${digest.slice(0, 32)}`
}

/**
 * Migrate the pre-foundation shape only when it is unambiguous. A malformed
 * current registry is reported as corrupt and is never overwritten.
 */
function migrateLegacy(value: unknown, now: string): ProjectRegistry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const envelope = value as Record<string, unknown>
  if (!Array.isArray(envelope.projects) || envelope.kind !== undefined || envelope.version !== undefined) return null
  const projects = envelope.projects.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProjectRegistryError('legacy project entry is invalid')
    const entry = raw as Record<string, unknown>
    const name = normalizedName(entry.name)
    const membership = Array.isArray(entry.sourceProjectMembership)
      ? entry.sourceProjectMembership.filter(validSourceId)
      : []
    return {
      id: validId(entry.id) ? entry.id : deterministicMigratedId(index, name, membership),
      name,
      icon: (METRORA_PROJECT_ICONS[index % METRORA_PROJECT_ICONS.length] ?? 'grid') as MetroraProjectIcon,
      color: (METRORA_PROJECT_COLORS[index % METRORA_PROJECT_COLORS.length] ?? 'cyan') as MetroraProjectColor,
      sourceProjectMembership: [...new Set(membership)],
      createdAt: validIso(entry.createdAt) ? new Date(entry.createdAt).toISOString() : now,
      updatedAt: validIso(entry.updatedAt) ? new Date(entry.updatedAt).toISOString() : now,
    }
  })
  return validateRegistry({ kind: METRORA_PROJECT_REGISTRY_KIND, version: METRORA_PROJECT_REGISTRY_VERSION, projects })
}

export async function readProjectRegistryAt(path: string): Promise<ProjectRegistryReadResult> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { registry: emptyProjectRegistry(), status: 'missing' }
    }
    return { registry: emptyProjectRegistry(), status: 'corrupt', error: 'project registry could not be read' }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    try {
      return { registry: validateRegistry(parsed), status: 'valid' }
    } catch {
      const migrated = migrateLegacy(parsed, new Date().toISOString())
      if (migrated) return { registry: migrated, status: 'migrated' }
      throw new ProjectRegistryError('project registry is invalid')
    }
  } catch (error) {
    return {
      registry: emptyProjectRegistry(),
      status: 'corrupt',
      error: error instanceof Error ? error.message : 'project registry is invalid',
    }
  }
}

export async function readProjectRegistry(): Promise<ProjectRegistryReadResult> {
  return readProjectRegistryAt(projectRegistryPath())
}

export async function writeProjectRegistryAt(path: string, registry: ProjectRegistry): Promise<void> {
  const valid = validateRegistry(registry)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(valid, null, 2) + '\n', 'utf8')
  await rename(temp, path)
}

export async function writeProjectRegistry(registry: ProjectRegistry): Promise<void> {
  await writeProjectRegistryAt(projectRegistryPath(), registry)
}

function requireWritableRegistry(result: ProjectRegistryReadResult): ProjectRegistry {
  if (result.status === 'corrupt') throw new ProjectRegistryError('project registry is corrupt; source projects remain unchanged')
  return cloneRegistry(result.registry)
}

function defaultPresentation(index: number): Pick<MetroraProject, 'icon' | 'color'> {
  return {
    icon: METRORA_PROJECT_ICONS[index % METRORA_PROJECT_ICONS.length] ?? 'grid',
    color: METRORA_PROJECT_COLORS[index % METRORA_PROJECT_COLORS.length] ?? 'cyan',
  }
}

export async function createMetroraProject(name: string, presentation: Pick<ProjectPresentationPatch, 'icon' | 'color'> = {}): Promise<MetroraProject> {
  const current = requireWritableRegistry(await readProjectRegistry())
  const now = new Date().toISOString()
  const defaults = defaultPresentation(current.projects.length)
  const project: MetroraProject = {
    id: `mp_${randomUUID().replace(/-/g, '')}`,
    name: normalizedName(name),
    icon: presentation.icon ?? defaults.icon,
    color: presentation.color ?? defaults.color,
    sourceProjectMembership: [],
    createdAt: now,
    updatedAt: now,
  }
  current.projects.push(project)
  await writeProjectRegistry(current)
  return project
}

export async function updateMetroraProject(id: string, patch: ProjectPresentationPatch): Promise<MetroraProject> {
  const current = requireWritableRegistry(await readProjectRegistry())
  const project = current.projects.find(value => value.id === id)
  if (!project) throw new ProjectRegistryError('project was not found')
  if (patch.name !== undefined) project.name = normalizedName(patch.name)
  if (patch.icon !== undefined) project.icon = icon(patch.icon)
  if (patch.color !== undefined) project.color = color(patch.color)
  project.updatedAt = new Date().toISOString()
  await writeProjectRegistry(current)
  return project
}

export async function deleteMetroraProject(id: string): Promise<void> {
  const current = requireWritableRegistry(await readProjectRegistry())
  const next = current.projects.filter(project => project.id !== id)
  if (next.length === current.projects.length) throw new ProjectRegistryError('project was not found')
  current.projects = next
  await writeProjectRegistry(current)
}

export async function assignSourceProject(projectId: string, sourceProjectId: string): Promise<MetroraProject> {
  if (!validSourceId(sourceProjectId)) throw new ProjectRegistryError('source project id is invalid')
  const current = requireWritableRegistry(await readProjectRegistry())
  const target = current.projects.find(project => project.id === projectId)
  if (!target) throw new ProjectRegistryError('project was not found')
  for (const project of current.projects) {
    project.sourceProjectMembership = project.sourceProjectMembership.filter(id => id !== sourceProjectId)
  }
  target.sourceProjectMembership.push(sourceProjectId)
  target.updatedAt = new Date().toISOString()
  await writeProjectRegistry(current)
  return target
}

export async function unassignSourceProject(sourceProjectId: string): Promise<void> {
  if (!validSourceId(sourceProjectId)) throw new ProjectRegistryError('source project id is invalid')
  const current = requireWritableRegistry(await readProjectRegistry())
  let changed = false
  for (const project of current.projects) {
    const next = project.sourceProjectMembership.filter(id => id !== sourceProjectId)
    if (next.length !== project.sourceProjectMembership.length) {
      project.sourceProjectMembership = next
      project.updatedAt = new Date().toISOString()
      changed = true
    }
  }
  if (changed) await writeProjectRegistry(current)
}
