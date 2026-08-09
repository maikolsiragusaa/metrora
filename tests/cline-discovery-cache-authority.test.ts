import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'

import { computeEnvFingerprint, PROVIDER_PARSE_VERSIONS } from '../src/session-cache.js'
import { getDailyCacheConfigHash } from '../src/usage-aggregator.js'

function previousClineFingerprint(): string {
  return createHash('sha256')
    .update('parser=worktree-project-grouping-v1')
    .digest('hex')
    .slice(0, 16)
}

describe('Cline discovery cache authority', () => {
  it('invalidates the prior provider section and daily source-backed history', () => {
    expect(PROVIDER_PARSE_VERSIONS['cline']).toBe('worktree-project-grouping-v1-vscode-variants-v2-provider-zero-cost')
    expect(computeEnvFingerprint('cline')).not.toBe(previousClineFingerprint())
    expect(getDailyCacheConfigHash()).toContain(
      `clineCollector=${PROVIDER_PARSE_VERSIONS['cline']}`,
    )
  })
})
