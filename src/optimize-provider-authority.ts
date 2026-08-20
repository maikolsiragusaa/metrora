import { normalizeOptimizeProvider } from './optimize-cache-key.js'
import type { ActionKind, ActionPlan } from './act/types.js'

/** Optimize's transcript/config evidence is currently Claude-specific. */
export function providerCoversClaude(provider?: string): boolean {
  const scope = normalizeOptimizeProvider(provider)
  return scope === 'all' || scope === 'claude'
}

/** Do not turn a deliberately skipped Claude scan into observed-empty evidence. */
export function claudeOnlyDetector<T>(
  provider: string | undefined,
  detect: () => T | null,
): () => T | null {
  return providerCoversClaude(provider) ? detect : () => null
}

export type ActionTargetAuthority = 'claude-targeted' | 'provider-neutral' | 'manual-only'

/** Current Optimize action ownership. Unknown/future actions fail closed. */
export const ACTION_TARGET_AUTHORITY: Readonly<Record<ActionKind, ActionTargetAuthority>> = {
  'mcp-remove': 'claude-targeted',
  'mcp-project-scope': 'claude-targeted',
  'defer-enable': 'claude-targeted',
  'defer-alwaysload': 'claude-targeted',
  'defer-threshold': 'claude-targeted',
  'archive-skill': 'claude-targeted',
  'archive-agent': 'claude-targeted',
  'archive-command': 'claude-targeted',
  'claude-md-rule': 'claude-targeted',
  'shell-config': 'claude-targeted',
  'guard-install': 'manual-only',
  'guard-uninstall': 'manual-only',
  'model-default': 'manual-only',
}

function under(path: string, root: string): boolean {
  const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '')
  const [candidate, base] = [normalize(path), normalize(root)]
  const compare = process.platform === 'win32' ? (value: string) => value.toLowerCase() : (value: string) => value
  const [normalizedCandidate, normalizedBase] = [compare(candidate), compare(base)]
  return normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(normalizedBase + '/')
}

/** A neutral action must not smuggle a Claude-owned destination into a plan. */
export function actionTargetAuthorized(
  provider: string | undefined,
  plan: ActionPlan,
  claudePaths: readonly string[],
): boolean {
  const authority = ACTION_TARGET_AUTHORITY[plan.kind]
  if (authority === 'claude-targeted') return providerCoversClaude(provider)
  if (authority !== 'provider-neutral') return false
  if (providerCoversClaude(provider)) return true
  return plan.changes.every(change => {
    const paths = change.op === 'move' ? [change.path, change.movedTo] : [change.path]
    return paths.every(path => !claudePaths.some(root => under(path, root)))
  })
}
