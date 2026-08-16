import { CliError } from './cli'
import { sanitizeError } from './quota'
import type { Envelope } from './main'

type Handler = (...args: any[]) => Promise<Envelope>

type ProjectBridgeDeps = {
  spawnCli: (args: string[], opts?: { extraEnv?: NodeJS.ProcessEnv }) => Promise<unknown>
  spawnCliAction: (args: string[], opts?: { timeoutMs?: number }) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>
  snapshotEnv: NodeJS.ProcessEnv
}

const ICONS = ['grid', 'spark', 'orbit', 'stack', 'terminal', 'branch'] as const
const COLORS = ['cyan', 'blue', 'violet', 'amber', 'green', 'coral'] as const
type MetroraProjectIcon = typeof ICONS[number]
type MetroraProjectColor = typeof COLORS[number]

function projectError(error: unknown): { kind: string; message: string } {
  if (error instanceof CliError) return { kind: error.kind, message: sanitizeError(error.message) }
  return { kind: 'nonzero', message: sanitizeError(error instanceof Error ? error.message : String(error)) }
}

export function validateProjectScope(value: string | null | undefined): string | null {
  if (value == null || value === '' || value === 'all') return null
  if (!/^(?:unassigned|mp_[a-z0-9_-]{16,80})$/i.test(value)) throw new CliError('bad-args', 'invalid Metrora Project scope')
  return value
}

function projectId(value: string): string {
  const parsed = validateProjectScope(value)
  if (!parsed?.startsWith('mp_')) throw new CliError('bad-args', 'invalid Metrora Project id')
  return parsed
}

function sourceProjectId(value: string): string {
  if (!/^sp_[a-f0-9]{64}$/.test(value)) throw new CliError('bad-args', 'invalid Source Project id')
  return value
}

function projectName(value: string): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 120) throw new CliError('bad-args', 'invalid Metrora Project name')
  return name
}

function projectIcon(value: string | undefined): MetroraProjectIcon | undefined {
  if (value == null) return undefined
  if (!ICONS.includes(value as MetroraProjectIcon)) throw new CliError('bad-args', 'invalid Metrora Project icon')
  return value as MetroraProjectIcon
}

function projectColor(value: string | undefined): MetroraProjectColor | undefined {
  if (value == null) return undefined
  if (!COLORS.includes(value as MetroraProjectColor)) throw new CliError('bad-args', 'invalid Metrora Project color')
  return value as MetroraProjectColor
}

export function createProjectBridgeHandlers(deps: ProjectBridgeDeps): Record<string, Handler> {
  const action = async (args: string[]): Promise<unknown> => {
    const result = await deps.spawnCliAction(args)
    if (!result.ok) throw new CliError('nonzero', result.stderr || 'project action failed')
    try { return JSON.parse(result.stdout) }
    catch { throw new CliError('bad-json', 'project action returned invalid data') }
  }
  const guarded = (operation: (...args: any[]) => Promise<unknown>): Handler => async (...args) => {
    try { return { ok: true, value: await operation(...args) } }
    catch (error) { return { ok: false, error: projectError(error) } }
  }

  return {
    'metrora:getProjects': async () => {
      try {
        const value = await deps.spawnCli(['status', '--format', 'menubar-json', '--period', 'all', '--no-timeline', '--no-optimize'], { extraEnv: deps.snapshotEnv }) as { projectScope?: unknown }
        return { ok: true, value: value.projectScope ?? { selectedId: 'all', options: [], sourceProjects: [], registry: { status: 'missing', writable: true } } }
      } catch (error) { return { ok: false, error: projectError(error) } }
    },
    'metrora:createProject': guarded((name: string, icon?: string, color?: string) =>
      action(['projects', 'create', projectName(name), '--icon', projectIcon(icon) ?? 'grid', '--color', projectColor(color) ?? 'cyan'])),
    'metrora:updateProject': guarded((id: string, patch: { name?: string; icon?: string; color?: string }) =>
      action([
        'projects', 'update', projectId(id),
        ...(patch?.name === undefined ? [] : ['--name', projectName(patch.name)]),
        ...(patch?.icon === undefined ? [] : ['--icon', projectIcon(patch.icon)!]),
        ...(patch?.color === undefined ? [] : ['--color', projectColor(patch.color)!]),
      ])),
    'metrora:deleteProject': guarded(async (id: string) => {
      await action(['projects', 'delete', projectId(id)])
      return true
    }),
    'metrora:assignSourceProject': guarded((id: string, sourceId: string) =>
      action(['projects', 'assign', projectId(id), sourceProjectId(sourceId)])),
    'metrora:unassignSourceProject': guarded(async (sourceId: string) => {
      await action(['projects', 'unassign', sourceProjectId(sourceId)])
      return true
    }),
  }
}
