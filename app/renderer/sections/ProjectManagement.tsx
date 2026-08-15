import { useCallback, useEffect, useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { metrora } from '../lib/ipc'
import type { ProjectScopePayload } from '../lib/types'

const ICONS = ['grid', 'spark', 'orbit', 'stack', 'terminal', 'branch']
const COLORS = ['cyan', 'blue', 'violet', 'amber', 'green', 'coral']

function userProjects(data: ProjectScopePayload): Array<{ id: string; name: string; icon: string; color: string; sourceProjectCount: number }> {
  return data.options.filter(option => option.id.startsWith('mp_'))
}

/** Desktop-owned CRUD surface for the persistent Metrora Project overlay. */
export function ProjectManagement() {
  const [data, setData] = useState<ProjectScopePayload | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState(ICONS[0]!)
  const [newColor, setNewColor] = useState(COLORS[0]!)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState('grid')
  const [editColor, setEditColor] = useState('cyan')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const next = await metrora.getProjects()
      setData(next)
      const projects = userProjects(next)
      setSelectedId(current => current && projects.some(project => project.id === current) ? current : projects[0]?.id ?? null)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Projects could not be loaded.')
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const projects = useMemo(() => data ? userProjects(data) : [], [data])
  const selected = projects.find(project => project.id === selectedId) ?? null
  const assignedSources = data?.sourceProjects.filter(source => source.assignedProjectId === selectedId) ?? []
  const unassignedSources = data?.sourceProjects.filter(source => source.assignedProjectId !== selectedId) ?? []

  useEffect(() => {
    if (!selected) return
    setEditName(selected.name)
    setEditIcon(selected.icon)
    setEditColor(selected.color)
  }, [selected])

  const action = async (run: () => Promise<unknown>, success?: () => void) => {
    setBusy(true)
    setError('')
    try {
      await run()
      success?.()
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Project action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const create = () => {
    if (!newName.trim()) return
    void action(
      () => metrora.createProject(newName.trim(), newIcon, newColor),
      () => { setNewName('') },
    )
  }

  const update = () => {
    if (!selected) return
    void action(() => metrora.updateProject(selected.id, { name: editName.trim(), icon: editIcon, color: editColor }))
  }

  const remove = () => {
    if (!selected) return
    void action(() => metrora.deleteProject(selected.id), () => setSelectedId(null))
  }

  const assignmentChanged = (sourceId: string, value: string) => {
    void action(() => value
      ? metrora.assignSourceProject(value, sourceId)
      : metrora.unassignSourceProject(sourceId))
  }

  return (
    <section className="set-p on project-management">
      <div>
        <h3 className="set-h">Metrora Projects</h3>
        <p className="set-sub">Organize observed Source Projects without changing their provenance, sessions, or accounting.</p>
      </div>
      {error && <p className="set-action-msg error" role="alert">{error}</p>}
      {data?.registry.status === 'corrupt' && (
        <Panel><EmptyNote>The Project registry is unreadable. Source Projects remain safe; repair the registry before editing.</EmptyNote></Panel>
      )}
      <Panel>
        <div className="project-create-row">
          <input className="set-input" aria-label="New Metrora Project name" placeholder="New Project name" value={newName} onChange={event => setNewName(event.target.value)} />
          <select className="set-input" aria-label="New Project icon" value={newIcon} onChange={event => setNewIcon(event.target.value)}>
            {ICONS.map(icon => <option key={icon} value={icon}>{icon}</option>)}
          </select>
          <select className="set-input" aria-label="New Project color" value={newColor} onChange={event => setNewColor(event.target.value)}>
            {COLORS.map(color => <option key={color} value={color}>{color}</option>)}
          </select>
          <button className="btnp btnp-primary" disabled={busy || !newName.trim() || data?.registry.writable === false} onClick={create}>Create Project</button>
        </div>
      </Panel>
      <Panel>
        <div className="about-sec-h">Projects</div>
        {projects.length === 0 ? <EmptyNote>No Metrora Projects yet. Source Projects remain Unassigned until you assign them.</EmptyNote> : (
          <div className="project-list">
            {projects.map(project => (
              <button key={project.id} type="button" className={`project-list-row${project.id === selectedId ? ' on' : ''}`} onClick={() => setSelectedId(project.id)}>
                <span className={`project-token color-${project.color}`} aria-hidden="true">{project.icon.slice(0, 1).toUpperCase()}</span>
                <span className="tx">{project.name}<small>{project.sourceProjectCount} Source Project{project.sourceProjectCount === 1 ? '' : 's'}</small></span>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {selected && (
        <Panel>
          <div className="about-sec-h">Customize {selected.name}</div>
          <div className="about-row"><label className="tx" htmlFor="project-edit-name">Name</label><span className="r"><input id="project-edit-name" className="set-input" value={editName} onChange={event => setEditName(event.target.value)} /></span></div>
          <div className="about-row"><label className="tx" htmlFor="project-edit-icon">Icon</label><span className="r"><select id="project-edit-icon" className="set-input" value={editIcon} onChange={event => setEditIcon(event.target.value)}>{ICONS.map(icon => <option key={icon} value={icon}>{icon}</option>)}</select></span></div>
          <div className="about-row"><label className="tx" htmlFor="project-edit-color">Color</label><span className="r"><select id="project-edit-color" className="set-input" value={editColor} onChange={event => setEditColor(event.target.value)}>{COLORS.map(color => <option key={color} value={color}>{color}</option>)}</select></span></div>
          <div className="about-row"><span className="tx">Stable identity<small>Name, icon and color are presentation metadata only.</small></span><span className="r"><code>{selected.id}</code></span></div>
          <div className="project-actions"><button className="btnp btnp-primary" disabled={busy || !editName.trim() || data?.registry.writable === false} onClick={update}>Save presentation</button><button className="btnp" disabled={busy || data?.registry.writable === false} onClick={remove}>Delete Project</button></div>
        </Panel>
      )}
      <Panel>
        <div className="about-sec-h">Source Projects</div>
        <p className="set-cap">Paths stay in the desktop/core authority. This view shows only safe project labels and factual collector contributors.</p>
        {(assignedSources.length + unassignedSources.length) === 0 ? <EmptyNote>No observed Source Projects are available in this period.</EmptyNote> : (
          <div className="project-source-list">
            {[...assignedSources, ...unassignedSources].map(source => (
              <div className="project-source-row" key={source.id}>
                <span className="tx">{source.name}<small>{source.contributors.map(contributor => contributor.sourceId).join(', ') || 'Unknown source'}</small></span>
                <select className="set-input" aria-label={`Assign ${source.name}`} value={source.assignedProjectId ?? ''} disabled={busy || data?.registry.writable === false} onChange={event => assignmentChanged(source.id, event.target.value)}>
                  <option value="">Unassigned</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </section>
  )
}
