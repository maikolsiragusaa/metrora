import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  assignSourceProject,
  createMetroraProject,
  deleteMetroraProject,
  ProjectRegistryError,
  readProjectRegistry,
  updateMetroraProject,
  unassignSourceProject,
} from '../src/project-registry.js'
import { projectRegistryPath } from '../src/project-registry.js'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'metrora-project-registry-'))
  process.env.METRORA_CONFIG_DIR = root
})

describe('Metrora Project registry', () => {
  it('persists create, presentation edits, stable identity, assignment and unassignment', async () => {
    const project = await createMetroraProject('Metrora', { icon: 'spark', color: 'blue' })
    const sourceId = `sp_${'a'.repeat(64)}`
    await assignSourceProject(project.id, sourceId)
    const renamed = await updateMetroraProject(project.id, { name: 'Metrora Core', icon: 'branch', color: 'coral' })

    expect(renamed.id).toBe(project.id)
    expect(renamed.sourceProjectMembership).toEqual([sourceId])
    expect(renamed.name).toBe('Metrora Core')
    expect(renamed.icon).toBe('branch')
    expect(renamed.color).toBe('coral')

    await unassignSourceProject(sourceId)
    const read = await readProjectRegistry()
    expect(read.status).toBe('valid')
    expect(read.registry.projects[0]?.id).toBe(project.id)
    expect(read.registry.projects[0]?.sourceProjectMembership).toEqual([])
  })

  it('deletes only the overlay and preserves the original Source Project id', async () => {
    const project = await createMetroraProject('Disposable group')
    const sourceId = `sp_${'b'.repeat(64)}`
    await assignSourceProject(project.id, sourceId)
    await deleteMetroraProject(project.id)

    const read = await readProjectRegistry()
    expect(read.registry.projects).toEqual([])
    expect(sourceId).toMatch(/^sp_[a-f0-9]{64}$/)
  })

  it('migrates a legacy project envelope deterministically', async () => {
    const path = projectRegistryPath()
    await writeFile(path, JSON.stringify({ projects: [{ name: 'Legacy', sourceProjectMembership: [] }] }), 'utf8')
    const first = await readProjectRegistry()
    const second = await readProjectRegistry()
    expect(first.status).toBe('migrated')
    expect(second.registry.projects[0]?.id).toBe(first.registry.projects[0]?.id)
    expect(first.registry.projects[0]?.icon).toBe('grid')
  })

  it('fails safe on corruption and never overwrites the invalid file', async () => {
    const path = projectRegistryPath()
    const invalid = '{"kind":"metrora.project-registry","version":999,"projects":[]}'
    await writeFile(path, invalid, 'utf8')
    const read = await readProjectRegistry()
    expect(read.status).toBe('corrupt')
    expect(read.registry.projects).toEqual([])
    await expect(createMetroraProject('Must not overwrite')).rejects.toBeInstanceOf(ProjectRegistryError)
    expect(await readFile(path, 'utf8')).toBe(invalid)
  })
})
