import { normalizeOptimizeProvider } from './optimize-cache-key.js'

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
