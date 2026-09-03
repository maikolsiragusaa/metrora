import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Metrora's authority seam for the DSH tool pipeline.
 *
 * Read-only Metrora facts and discovery tools may execute. Bounded foreground
 * subagent delegation is also allowed, but its child is tool-filtered to this
 * same read-only set. Every mutation/process capability is denied until a
 * Metrora Shield/ACT capability is explicitly supplied by the host. This keeps
 * DSH's commodity tools useful without allowing a second authority model to
 * emerge inside the Harness runtime.
 */
export type MetroraHarnessAuthority = {
  decide(execution: Pick<ToolExecution, 'name'>): PreToolDecision
}

const READ_ONLY_TOOLS = new Set([
  'subagent',
  'get_spend_snapshot',
  'get_model_efficiency',
  'get_quota_snapshot',
  'get_overview_snapshot',
  'get_project_drivers',
  'get_session_highlights',
  'get_coverage_report',
  'get_bench_evidence',
])

const MUTATING_OR_CAPABILITY_TOOLS = /(?:^|[_-])(write|edit|replace|delete|move|run|shell|process|pwsh|background|subagent)(?:$|[_-])/iu

export function createMetroraHarnessAuthority(): MetroraHarnessAuthority {
  return {
    decide: execution => {
      if (READ_ONLY_TOOLS.has(execution.name)) return { kind: 'allow' }
      if (MUTATING_OR_CAPABILITY_TOOLS.test(execution.name)) {
        return { kind: 'deny', reason: 'Metrora Shield requires an ACT-approved capability for this action.' }
      }
      return { kind: 'deny', reason: 'This Harness capability is not authorized by Metrora Shield.' }
    },
  }
}

export const METRORA_READ_ONLY_TOOL_NAMES = [...READ_ONLY_TOOLS] as const
