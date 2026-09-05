import type { Command } from 'commander'

import { loadPricing } from '../models.js'
import {
  assertStrictBoundedMetroraToolContent,
  assertMetroraToolName,
  MetroraToolContractError,
  parseMetroraToolArguments,
  validateMetroraToolArguments,
} from './contract.js'
import type { MetroraMcpProvider, MetroraMcpStartupOptions } from '../mcp/runtime.js'
import { createMetroraToolRuntime } from '../mcp/runtime.js'
import type { MetroraToolPeriod, MetroraToolRegistry } from './types.js'

const TOOL_PERIODS: ReadonlySet<MetroraToolPeriod> = new Set([
  'today',
  'week',
  '30days',
  'month',
  'all',
  'lifetime',
])
const TOOL_PROVIDERS: ReadonlySet<MetroraMcpProvider> = new Set(['all', 'claude', 'codex'])

export type MetroraToolsCallOptions = {
  argsJson: string
  period: string
  provider: string
  projectId: string
}

export type MetroraToolsCallDependencies = {
  createRuntime?: (options: MetroraMcpStartupOptions) => Promise<MetroraToolRegistry>
  loadPricing?: () => Promise<void>
  writeStdout?: (value: string) => void
  writeStderr?: (value: string) => void
}

function isToolPeriod(value: string): value is MetroraToolPeriod {
  return TOOL_PERIODS.has(value as MetroraToolPeriod)
}

function isToolProvider(value: string): value is MetroraMcpProvider {
  return TOOL_PROVIDERS.has(value as MetroraMcpProvider)
}

function safeErrorCode(error: unknown): string {
  if (error instanceof MetroraToolContractError) return error.code
  if (error instanceof Error && error.name === 'MetroraMcpStartupError') return 'startup-unavailable'
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  return 'unavailable'
}

function safeErrorMessage(error: unknown): string {
  return `metrora tools call failed (${safeErrorCode(error)}).`
}

/** Execute one canonical registry tool without adding a second evidence path. */
export async function callMetroraTool(
  toolName: string,
  options: MetroraToolsCallOptions,
  dependencies: Pick<MetroraToolsCallDependencies, 'createRuntime' | 'loadPricing'> = {},
): Promise<string> {
  const name = assertMetroraToolName(toolName)
  const parsed = parseMetroraToolArguments(options.argsJson)
  const args = validateMetroraToolArguments(name, parsed)

  if (!isToolPeriod(options.period)) throw new MetroraToolContractError('invalid-scope', 'Metrora tool period is unsupported.')
  if (!isToolProvider(options.provider)) throw new MetroraToolContractError('invalid-scope', 'Metrora tool provider is unsupported.')
  if (typeof options.projectId !== 'string' || !options.projectId.trim()) {
    throw new MetroraToolContractError('invalid-scope', 'Metrora tool Project scope is invalid.')
  }

  await (dependencies.loadPricing ?? loadPricing)()
  const runtime = await (dependencies.createRuntime ?? createMetroraToolRuntime)({
    period: options.period,
    provider: options.provider,
    projectId: options.projectId,
  })
  const execution = await runtime.execute(name, args)
  return assertStrictBoundedMetroraToolContent(execution.content)
}

/** CLI boundary: stdout is result content only; diagnostics are bounded and safe. */
export async function runMetroraToolsCall(
  toolName: string,
  options: MetroraToolsCallOptions,
  dependencies: MetroraToolsCallDependencies = {},
): Promise<number> {
  const stdout = dependencies.writeStdout ?? (value => process.stdout.write(value))
  const stderr = dependencies.writeStderr ?? (value => process.stderr.write(value))
  try {
    const content = await callMetroraTool(toolName, options, dependencies)
    stdout(content + '\n')
    return 0
  } catch (error) {
    stderr(safeErrorMessage(error) + '\n')
    return 2
  }
}

type MetroraToolsCommandOptions = MetroraToolsCallOptions

/** Register the read-only canonical Tools CLI adapter. */
export function registerMetroraToolCommands(program: Command): void {
  program
    .command('tools')
    .description('Call a canonical read-only Metrora Tool')
    .command('call <tool-name>')
    .description('Return bounded canonical Tool result content as JSON')
    .requiredOption('--args-json <json>', 'Tool arguments as one JSON object')
    .option('--period <period>', 'Initial scope: today, week, 30days, month, all, lifetime', 'all')
    .option('--provider <provider>', 'Initial provider scope: all, claude, codex', 'all')
    .option('--project-id <projectId>', 'Initial user-owned Metrora Project scope', 'all')
    .action(async (toolName: string, options: MetroraToolsCommandOptions) => {
      const exitCode = await runMetroraToolsCall(toolName, options)
      if (exitCode !== 0) process.exitCode = exitCode
    })
}
