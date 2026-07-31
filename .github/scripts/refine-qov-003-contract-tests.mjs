import { readFileSync, writeFileSync } from 'node:fs'

const path = '.github/scripts/apply-qov-003.mjs'
let content = readFileSync(path, 'utf8')

function replaceExact(before, after) {
  const count = content.split(before).length - 1
  if (count !== 1) throw new Error(`expected one applicator fragment, found ${count}`)
  content = content.replace(before, after)
}

replaceExact(
  "write('app/renderer/sections/Sessions.reasoning.test.ts', `import { describe, expect, it } from 'vitest'\\n",
  "write('app/renderer/sections/Sessions.reasoning.test.ts', `// @vitest-environment jsdom\\nimport { describe, expect, it } from 'vitest'\\n",
)

const anchor = "update('README.md', [\n"
const contractUpdate = `update('tests/cli-emitters.test.ts', [
  [
    "        'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',\\n        'startedAt', 'endedAt', 'durationMs',\\n",
    "        'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',\\n        'reasoningTokens', 'reasoningMix',\\n        'startedAt', 'endedAt', 'durationMs',\\n",
  ],
  [
    "      expect(rows.every(row => row.provider === 'claude')).toBe(true)\\n",
    "      expect(rows.every(row => row.provider === 'claude')).toBe(true)\\n      expect(rows.every(row => typeof row.reasoningTokens === 'number')).toBe(true)\\n      expect(rows.every(row => {\\n        const mix = row.reasoningMix as { totalCalls?: number; rows?: Array<{ level?: string }> } | undefined\\n        return mix?.totalCalls === row.calls && mix.rows?.some(item => item.level === 'unknown')\\n      })).toBe(true)\\n",
  ],
])

`

const count = content.split(anchor).length - 1
if (count !== 1) throw new Error(`expected one README anchor, found ${count}`)
content = content.replace(anchor, contractUpdate + anchor)
writeFileSync(path, content)
