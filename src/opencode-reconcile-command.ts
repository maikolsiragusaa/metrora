import type { Command } from 'commander'

import { assertProvider } from './cli-validation.js'
import { loadPricing } from './models.js'
import { parseAllSessions } from './parser.js'

export function registerOpenCodeReconcileCommand(program: Command): void {
  program
    .command('reconcile', { hidden: true })
    .description('Reconcile one provider source into the canonical session cache')
    .option('--provider <provider>', 'Provider to reconcile (currently only opencode)', 'opencode')
    .action(async (opts: { provider: string }) => {
      assertProvider(opts.provider, 'reconcile')
      if (opts.provider !== 'opencode') {
        process.stderr.write('metrora reconcile: only the opencode provider supports targeted reconciliation.\n')
        process.exit(1)
      }
      await loadPricing()
      const projects = await parseAllSessions(undefined, 'opencode')
      const calls = projects.reduce((total, project) => total + project.sessions.reduce(
        (sessionTotal, session) => sessionTotal + session.turns.reduce(
          (turnTotal, turn) => turnTotal + turn.assistantCalls.length,
          0,
        ),
        0,
      ), 0)
      console.log(JSON.stringify({ ok: true, provider: 'opencode', projects: projects.length, calls }))
    })
}
