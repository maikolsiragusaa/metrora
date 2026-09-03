import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import path from 'node:path'

import type { HarnessMode, HarnessRiskCategory } from './harness-runtime-types.js'

export type HarnessAuthority = {
  decide(execution: Pick<ToolExecution, 'name' | 'arguments' | 'agent'>, context?: { mode?: HarnessMode; workspaceRoot?: string | null }): PreToolDecision
  classify(name: string, args?: unknown): HarnessRiskCategory
}

const FACTUAL_TOOLS = new Set([
  'get_spend_snapshot', 'get_model_efficiency', 'get_quota_snapshot', 'get_overview_snapshot',
  'get_project_drivers', 'get_session_highlights', 'get_coverage_report', 'get_bench_evidence',
])
const READ_TOOLS = new Set(['read', 'read_image', 'glob', 'grep', 'web_fetch', 'list_directory', 'git_status', 'git_diff', 'git_log', 'git_show'])
const FILE_MUTATIONS = new Set(['write', 'edit', 'patch', 'apply_patch', 'rename', 'move', 'delete'])
const PROCESS_TOOLS = new Set(['bash', 'terminal_open', 'terminal_send', 'terminal_signal', 'terminal_close'])
const SAFE_TERMINAL_READS = new Set(['terminal_read', 'terminal_list'])
const GIT_READ = /^(?:git\s+(?:status|diff|log|show|branch|blame|remote|ls-files))(?:\s|$)/iu
const GIT_REMOTE = /\bgit\s+(?:push|fetch|pull|clone|remote\s+(?:add|remove|set-url|rename|prune))(?:\s|$)/iu
const GIT_DESTRUCTIVE = /\bgit\s+(?:merge|rebase|reset|clean|branch\s+(?:-D|-d|--delete)|tag)(?:\s|$)/iu
const GIT_LOCAL_MUTATION = /\bgit\s+(?:add|restore|switch|checkout|commit|branch)(?:\s|$)/iu

function commandFromArgs(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const row = value as Record<string, unknown>
  for (const key of ['command', 'cmd', 'script']) if (typeof row[key] === 'string') return row[key]
  return ''
}

function pathFromArgs(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  return row.path ?? row.filePath ?? row.file_path ?? row.workdir ?? row.cwd
}

function lexicallyContained(root: string | null | undefined, value: unknown): boolean {
  if (!root || typeof value !== 'string' || !value.trim()) return true
  if (!/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value)) return true
  const normalize = (input: string) => path.resolve(input).replace(/[\\/]+$/u, '').toLowerCase()
  const base = normalize(root)
  const candidate = normalize(value)
  return candidate === base || candidate.startsWith(base + path.sep.toLowerCase())
}

export function createMetroraHarnessAuthority(): HarnessAuthority {
  return {
    classify(name, args) {
      if (name.startsWith('mcp__')) return 'external'
      if (FACTUAL_TOOLS.has(name) || READ_TOOLS.has(name) || SAFE_TERMINAL_READS.has(name)) return name === 'web_fetch' ? 'network' : 'read-only'
      if (FILE_MUTATIONS.has(name)) return name.startsWith('git') ? 'git-local' : 'workspace-mutation'
      if (name === 'subagent') return 'read-only'
      if (PROCESS_TOOLS.has(name)) {
        const command = commandFromArgs(args)
        if (GIT_REMOTE.test(command)) return 'git-remote'
        if (GIT_DESTRUCTIVE.test(command)) return 'git-destructive'
        if (GIT_LOCAL_MUTATION.test(command)) return 'git-local'
        if (GIT_READ.test(command)) return 'read-only'
        return 'process'
      }
      return 'workspace-mutation'
    },
    decide(execution, context = {}) {
      const name = execution.name
      const mode = context.mode ?? 'build'
      if (name.startsWith('mcp__')) return { kind: 'ask', reason: 'External MCP Tools always require explicit Metrora Shield approval.' }
      if (!lexicallyContained(context.workspaceRoot, pathFromArgs(execution.arguments))) {
        return { kind: 'deny', reason: 'The requested path is outside the selected Workspace.' }
      }
      if (FACTUAL_TOOLS.has(name) || name === 'web_fetch') return { kind: 'allow' }
      if (READ_TOOLS.has(name) || SAFE_TERMINAL_READS.has(name)) {
        if (!context.workspaceRoot) return { kind: 'deny', reason: 'Open a local Workspace before using coding Tools.' }
        return { kind: 'allow' }
      }
      if (name === 'subagent') return { kind: 'allow' }
      const risk = this.classify(name, execution.arguments)
      if (!context.workspaceRoot && risk !== 'read-only') {
        return { kind: 'deny', reason: 'Open a local Workspace before using state-changing Harness capabilities.' }
      }
      if (risk === 'read-only') return { kind: 'allow' }
      if (mode === 'ask') return { kind: 'deny', reason: 'Ask mode is read-only. Switch to Edit or Build for state-changing actions.' }
      if (mode === 'plan') return { kind: 'deny', reason: 'Plan mode is read-only; state-changing actions are not permitted.' }
      if (mode === 'edit' && risk === 'process') return { kind: 'ask', reason: 'Run a bounded command in the selected Workspace.' }
      if (risk === 'git-remote' || risk === 'git-destructive') return { kind: 'ask', reason: 'This Git operation changes remote state or history.' }
      if (risk === 'workspace-mutation' || risk === 'git-local' || risk === 'process') return { kind: 'ask', reason: 'Metrora Shield requires approval before this Workspace action.' }
      return { kind: 'deny', reason: 'This Harness capability is not authorized by Metrora Shield.' }
    },
  }
}

export const METRORA_READ_ONLY_TOOL_NAMES = [
  ...FACTUAL_TOOLS,
  ...READ_TOOLS,
  ...SAFE_TERMINAL_READS,
  'subagent',
] as const
export const METRORA_HARNESS_TOOL_NAMES = [
  ...METRORA_READ_ONLY_TOOL_NAMES,
  ...FILE_MUTATIONS,
  ...PROCESS_TOOLS,
] as const
