import type { Command } from 'commander'

import type { MetroraToolPeriod } from '../tools/types.js'
import type { MetroraMcpProvider, MetroraMcpStartupOptions } from './runtime.js'

const MCP_PERIODS: ReadonlySet<MetroraToolPeriod> = new Set([
  'today',
  'week',
  '30days',
  'month',
  'all',
  'lifetime',
])
const MCP_PROVIDERS: ReadonlySet<MetroraMcpProvider> = new Set(['all', 'claude', 'codex'])

type McpServeOptions = {
  period: string
  provider: string
  projectId: string
}

type McpInfoOptions = {
  json?: boolean
}

function isMcpPeriod(value: string): value is MetroraToolPeriod {
  return MCP_PERIODS.has(value as MetroraToolPeriod)
}

function isMcpProvider(value: string): value is MetroraMcpProvider {
  return MCP_PROVIDERS.has(value as MetroraMcpProvider)
}

function safeStartupError(error: unknown): string {
  if (error instanceof Error && error.name === 'MetroraMcpStartupError') return error.message
  return 'Metrora MCP server could not start.'
}

async function runMcpServe(version: string, options: McpServeOptions): Promise<void> {
  if (!isMcpPeriod(options.period)) {
    process.stderr.write('metrora: unsupported MCP period.\n')
    process.exitCode = 2
    return
  }
  if (!isMcpProvider(options.provider)) {
    process.stderr.write('metrora: unsupported MCP provider.\n')
    process.exitCode = 2
    return
  }

  const startup: MetroraMcpStartupOptions = {
    period: options.period,
    provider: options.provider,
    projectId: options.projectId,
  }
  try {
    const { startStdioServer } = await import('./server.js')
    await startStdioServer(version, startup)
  } catch (error) {
    process.stderr.write(`metrora: ${safeStartupError(error)}\n`)
    process.exitCode = 2
  }
}

/** Register the complete MCP CLI surface while keeping main.ts wiring-only. */
export function registerMetroraMcpCommands(program: Command, version: string): void {
  const mcp = program
    .command('mcp')
    .description('Run the local read-only MCP server')

  mcp
    .command('serve')
    .description('Run the local MCP server over stdio')
    .option('--period <period>', 'Initial bounded period: today, week, 30days, month, all, lifetime', 'all')
    .option('--provider <provider>', 'Initial provider scope: all, claude, codex', 'all')
    .option('--project-id <projectId>', 'Initial user-owned Metrora Project scope', 'all')
    .action(async (options: McpServeOptions) => {
      await runMcpServe(version, options)
    })

  mcp
    .command('info')
    .description('Print the local MCP server contract and discovery metadata')
    .option('--json', 'Output machine-readable JSON')
    .action(async (options: McpInfoOptions) => {
      const { renderMetroraMcpInfo } = await import('./info.js')
      process.stdout.write(renderMetroraMcpInfo(version, Boolean(options.json)))
    })

  // Preserve the original bare mcp entry point as an alias for serve.
  mcp.action(async () => {
    try {
      const { startStdioServer } = await import('./server.js')
      await startStdioServer(version)
    } catch (error) {
      process.stderr.write(`metrora: ${safeStartupError(error)}\n`)
      process.exitCode = 2
    }
  })
}
