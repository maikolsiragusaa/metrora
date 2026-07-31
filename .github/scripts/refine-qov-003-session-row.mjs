import { readFileSync, writeFileSync } from 'node:fs'

const path = '.github/scripts/apply-qov-003.mjs'
let content = readFileSync(path, 'utf8')

const before = `  [
    "    cacheReadTokens: session.totalCacheReadTokens,\\n    cacheWriteTokens: session.totalCacheWriteTokens,\\n    startedAt: session.firstTimestamp,\\n",
    "    cacheReadTokens: session.totalCacheReadTokens,\\n    cacheWriteTokens: session.totalCacheWriteTokens,\\n    reasoningTokens: session.totalReasoningTokens,\\n    ...(session.reasoningMix ? { reasoningMix: session.reasoningMix } : {}),\\n    startedAt: session.firstTimestamp,\\n",
  ],`

const after = `  [
    "    cacheReadTokens: session.totalCacheReadTokens,\\n    cacheWriteTokens: session.totalCacheWriteTokens,\\n    startedAt: session.firstTimestamp,\\n",
    "    cacheReadTokens: session.totalCacheReadTokens,\\n    cacheWriteTokens: session.totalCacheWriteTokens,\\n    ...(session.reasoningMix ? {\\n      reasoningTokens: session.totalReasoningTokens,\\n      reasoningMix: session.reasoningMix,\\n    } : {}),\\n    startedAt: session.firstTimestamp,\\n",
  ],`

const count = content.split(before).length - 1
if (count !== 1) throw new Error(`expected one session-row transform, found ${count}`)
content = content.replace(before, after)
writeFileSync(path, content)
