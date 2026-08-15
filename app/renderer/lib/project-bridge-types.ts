export type ProjectScopePayload = {
  selectedId: string
  options: Array<{ id: string; name: string; icon: string; color: string; sourceProjectCount: number }>
  sourceProjects: Array<{ id: string; name: string; contributors: Array<{ sourceId: string; routeIds: string[] }>; assignedProjectId: string | null }>
  registry: { status: 'missing' | 'valid' | 'migrated' | 'corrupt'; writable: boolean }
}

export interface ProjectBridge {
  getProjects(): Promise<ProjectScopePayload>
  createProject(name: string, icon?: string, color?: string): Promise<unknown>
  updateProject(id: string, patch: { name?: string; icon?: string; color?: string }): Promise<unknown>
  deleteProject(id: string): Promise<boolean>
  assignSourceProject(projectId: string, sourceProjectId: string): Promise<unknown>
  unassignSourceProject(sourceProjectId: string): Promise<boolean>
}
