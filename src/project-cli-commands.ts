import type { Command } from 'commander'

import {
  assignSourceProject,
  createMetroraProject,
  deleteMetroraProject,
  unassignSourceProject,
  updateMetroraProject,
  type MetroraProjectColor,
  type MetroraProjectIcon,
} from './project-registry.js'

function output(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n')
}

async function command(action: () => Promise<unknown>): Promise<void> {
  try {
    output(await action())
  } catch (error) {
    process.stderr.write(`metrora: project action failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

/** Register the Desktop-owned Project overlay mutations on the canonical CLI. */
export function registerProjectCommands(program: Command): void {
  const projects = program.command('projects').description('Manage user-created Metrora Projects')
  projects.command('create')
    .argument('<name>')
    .option('--icon <icon>')
    .option('--color <color>')
    .action(async (name: string, opts: { icon?: string; color?: string }) => {
      await command(() => createMetroraProject(name, { icon: opts.icon as MetroraProjectIcon | undefined, color: opts.color as MetroraProjectColor | undefined }))
    })
  projects.command('update')
    .argument('<id>')
    .option('--name <name>')
    .option('--icon <icon>')
    .option('--color <color>')
    .action(async (id: string, opts: { name?: string; icon?: string; color?: string }) => {
      await command(() => updateMetroraProject(id, {
        name: opts.name,
        icon: opts.icon as MetroraProjectIcon | undefined,
        color: opts.color as MetroraProjectColor | undefined,
      }))
    })
  projects.command('delete')
    .argument('<id>')
    .action(async (id: string) => {
      await command(async () => {
        await deleteMetroraProject(id)
        return { deleted: true, id }
      })
    })
  projects.command('assign')
    .argument('<projectId>')
    .argument('<sourceProjectId>')
    .action(async (projectId: string, sourceProjectId: string) => {
      await command(() => assignSourceProject(projectId, sourceProjectId))
    })
  projects.command('unassign')
    .argument('<sourceProjectId>')
    .action(async (sourceProjectId: string) => {
      await command(async () => {
        await unassignSourceProject(sourceProjectId)
        return { unassigned: true, sourceProjectId }
      })
    })
}
