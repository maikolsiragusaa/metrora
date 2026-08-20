import { join } from 'path'
import { normalizeOptimizeProvider } from '../optimize-cache-key.js'
import { actionTargetAuthorized } from '../optimize-provider-authority.js'
import type { BuiltPlan, ResolvedPaths } from './plans.js'
import type { FindingId } from '../optimize.js'

export function authorizeBuiltPlan(
  built: BuiltPlan,
  provider: string | undefined,
  r: ResolvedPaths,
  findingId: FindingId,
): BuiltPlan {
  if (!built.plan) return built
  const claudePaths = [
    join(r.homeDir, '.claude'), r.userClaudeJson,
    join(r.cwd, '.claude'), r.projectClaudeMd,
    r.projectMcpJson, r.userSettings, r.skillsDir, r.agentsDir, r.commandsDir,
    r.projectSettings, r.projectSettingsLocal,
  ]
  if (actionTargetAuthorized(provider, built.plan, claudePaths, findingId)) return built

  return {
    plan: null,
    notes: [
      ...built.notes,
      'manual: ' + built.plan.kind + ' targets Claude-managed state and is not auto-appliable under provider=' + normalizeOptimizeProvider(provider),
    ],
  }
}