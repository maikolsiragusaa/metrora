// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectScopePayload } from '../lib/project-bridge-types'
import { ProjectManagement } from './ProjectManagement'

const mocks = vi.hoisted(() => ({
  getProjects: vi.fn<() => Promise<ProjectScopePayload>>(),
  createProject: vi.fn<(name: string, icon?: string, color?: string) => Promise<unknown>>(),
  updateProject: vi.fn<(id: string, patch: { name?: string; icon?: string; color?: string }) => Promise<unknown>>(),
  deleteProject: vi.fn<(id: string) => Promise<boolean>>(),
  assignSourceProject: vi.fn<(projectId: string, sourceProjectId: string) => Promise<unknown>>(),
  unassignSourceProject: vi.fn<(sourceProjectId: string) => Promise<boolean>>(),
}))

vi.mock('../lib/ipc', () => ({ metrora: mocks }))

const projectId = 'mp_fixture'
const sourceProjects: ProjectScopePayload['sourceProjects'] = [
  { id: 'sp_one', name: 'one', contributors: [{ sourceId: 'codex', routeIds: ['openai'] }], assignedProjectId: null },
  { id: 'sp_two', name: 'two', contributors: [{ sourceId: 'claude-cli', routeIds: ['anthropic-api'] }], assignedProjectId: null },
  { id: 'sp_three', name: 'three', contributors: [{ sourceId: 'cursor', routeIds: ['openai'] }], assignedProjectId: null },
]

function catalog(): ProjectScopePayload {
  const assigned = sourceProjects.filter(source => source.assignedProjectId === projectId).length
  return {
    selectedId: 'all',
    options: [
      { id: 'all', name: 'All projects', icon: 'grid', color: 'cyan', sourceProjectCount: sourceProjects.length },
      { id: 'unassigned', name: 'Unassigned', icon: 'stack', color: 'violet', sourceProjectCount: sourceProjects.length - assigned },
      ...(projectCreated ? [{ id: projectId, name: projectName, icon: projectIcon, color: projectColor, sourceProjectCount: assigned }] : []),
    ],
    sourceProjects: sourceProjects.map(source => ({ ...source, contributors: source.contributors.map(value => ({ ...value, routeIds: [...value.routeIds] })) })),
    registry: { status: 'valid', writable: true },
  }
}

let projectCreated = false
let projectName = 'Foundation QA'
let projectIcon = 'spark'
let projectColor = 'cyan'

describe('ProjectManagement', () => {
  beforeEach(() => {
    projectCreated = false
    projectName = 'Foundation QA'
    projectIcon = 'spark'
    projectColor = 'cyan'
    sourceProjects.forEach(source => { source.assignedProjectId = null })
    Object.values(mocks).forEach(mock => mock.mockReset())
    mocks.getProjects.mockImplementation(async () => catalog())
    mocks.createProject.mockImplementation(async (name, icon = 'grid', color = 'cyan') => {
      projectCreated = true
      projectName = name
      projectIcon = icon
      projectColor = color
    })
    mocks.updateProject.mockImplementation(async (id, patch) => {
      expect(id).toBe(projectId)
      if (patch.name) projectName = patch.name
      if (patch.icon) projectIcon = patch.icon
      if (patch.color) projectColor = patch.color
    })
    mocks.assignSourceProject.mockImplementation(async (id, sourceId) => {
      expect(id).toBe(projectId)
      sourceProjects.find(source => source.id === sourceId)!.assignedProjectId = projectId
    })
    mocks.unassignSourceProject.mockImplementation(async sourceId => {
      sourceProjects.find(source => source.id === sourceId)!.assignedProjectId = null
      return true
    })
    mocks.deleteProject.mockImplementation(async id => {
      expect(id).toBe(projectId)
      projectCreated = false
      sourceProjects.forEach(source => { source.assignedProjectId = null })
      return true
    })
  })

  it('keeps Desktop Project identity and membership stable through create, presentation edits, assignment, refresh and delete', async () => {
    const user = userEvent.setup()
    render(<ProjectManagement />)

    await user.type(await screen.findByLabelText('New Metrora Project name'), 'Foundation QA')
    await user.selectOptions(screen.getByLabelText('New Project icon'), 'spark')
    await user.selectOptions(screen.getByLabelText('New Project color'), 'cyan')
    await user.click(screen.getByRole('button', { name: 'Create Project' }))
    await screen.findByRole('button', { name: /Foundation QA.*0 Source Projects/ })
    expect(mocks.createProject).toHaveBeenCalledWith('Foundation QA', 'spark', 'cyan')

    await user.click(screen.getByRole('button', { name: /Foundation QA.*0 Source Projects/ }))
    expect(screen.getByText(projectId)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Foundation QA Renamed')
    await user.selectOptions(screen.getByLabelText('Icon'), 'orbit')
    await user.selectOptions(screen.getByLabelText('Color'), 'violet')
    await user.click(screen.getByRole('button', { name: 'Save presentation' }))
    await screen.findByRole('button', { name: /Foundation QA Renamed.*0 Source Projects/ })
    expect(mocks.updateProject).toHaveBeenCalledWith(projectId, { name: 'Foundation QA Renamed', icon: 'orbit', color: 'violet' })
    expect(screen.getByText(projectId)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Assign one'), projectId)
    await waitFor(() => expect(screen.getByLabelText('Assign one')).toHaveValue(projectId))
    await user.selectOptions(screen.getByLabelText('Assign two'), projectId)
    await waitFor(() => expect(screen.getByLabelText('Assign two')).toHaveValue(projectId))
    expect(screen.getByRole('button', { name: /Foundation QA Renamed.*2 Source Projects/ })).toBeInTheDocument()
    expect(sourceProjects.find(source => source.id === 'sp_three')?.assignedProjectId).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Delete Project' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Foundation QA Renamed/ })).not.toBeInTheDocument())
    expect(mocks.deleteProject).toHaveBeenCalledWith(projectId)
    expect(screen.getByLabelText('Assign one')).toHaveValue('')
    expect(screen.getByLabelText('Assign two')).toHaveValue('')
    expect(screen.getByLabelText('Assign three')).toHaveValue('')
  })
})
