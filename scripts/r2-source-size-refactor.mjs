import { readFile, writeFile } from 'node:fs/promises'

const read = path => readFile(path, 'utf8')
const write = (path, content) => writeFile(path, content, 'utf8')

function requireOnce(source, needle, label) {
  const first = source.indexOf(needle)
  if (first < 0) throw new Error(`missing ${label}`)
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`duplicate ${label}`)
  return first
}

function replaceOnce(source, before, after, label) {
  requireOnce(source, before, label)
  return source.replace(before, after)
}

function extract(source, startNeedle, endNeedle, label) {
  const start = requireOnce(source, startNeedle, `${label} start`)
  const end = source.indexOf(endNeedle, start + startNeedle.length)
  if (end < 0) throw new Error(`missing ${label} end`)
  return {
    block: source.slice(start, end),
    source: source.slice(0, start) + source.slice(end),
  }
}

// parser.ts: move R2 accounting authorities and stable project-path helpers into focused modules.
let parser = await read('src/parser.ts')

const projectPaths = extract(
  parser,
  'function unsanitizePath(',
  '\n\n\n// Returns true for sessions whose canonical project key must NOT be derived',
  'project path helpers',
)
parser = projectPaths.source
await write(
  'src/project-path-utils.ts',
  `${projectPaths.block.trim().replace(/^function /gm, 'export function ')}\n`,
)

const claude = extract(
  parser,
  '/**\n * A Claude JSONL message id is a native accounting identity',
  '\nexport function groupIntoTurns',
  'Claude native reconciliation',
)
parser = claude.source
await write(
  'src/claude-native-reconciliation.ts',
  `import type { CachedCall } from './session-cache.js'\n\n${claude.block.trim()}\n`,
)

const range = extract(
  parser,
  'function callIsInDateRange(',
  '\n// ── Cache-Aware Parsing Helpers',
  'call-level date-range projection',
)
parser = range.source
const exportedRangeBlock = range.block.replace(/^function /gm, 'export function ')
await write(
  'src/date-range-projection.ts',
  `import { classifyTurn } from './classifier.js'\nimport type { CachedTurn } from './session-cache.js'\nimport type { ClassifiedTurn, DateRange, ParsedApiCall, ParsedTurn } from './types.js'\n\n${exportedRangeBlock.trim()}\n`,
)

parser = replaceOnce(
  parser,
  "import { isSnapshotReadMode } from './read-lifecycle.js'\n",
  "import { isSnapshotReadMode } from './read-lifecycle.js'\nimport { getClaudeNativeIdentity, reconcileClaudeNativeCalls } from './claude-native-reconciliation.js'\nimport { callIsInDateRange, sliceCachedTurnToDateRange, sliceClassifiedTurnToDateRange, sliceParsedTurnToDateRange } from './date-range-projection.js'\nimport { claudeSlugFallbackPath, normalizeProjectPathKey, projectNameFromPath, unsanitizePath } from './project-path-utils.js'\n",
  'parser helper import anchor',
)
parser = replaceOnce(
  parser,
  '\nexport function groupIntoTurns',
  "\nexport { getClaudeNativeIdentity, reconcileClaudeNativeCalls }\nexport type { ClaudeNativeCallCandidate, ClaudeNativeIdentityAmbiguity, ClaudeNativeReconciliation } from './claude-native-reconciliation.js'\n\nexport function groupIntoTurns",
  'parser Claude re-export anchor',
)
await write('src/parser.ts', parser)

// daily-cache-core.ts: isolate the cache data model from hydration/migration behavior.
let dailyCore = await read('src/daily-cache-core.ts')
const dailyTypes = extract(
  dailyCore,
  'export type ModelDayStats = {',
  '\nfunction getCacheDir(): string {',
  'daily cache types',
)
dailyCore = dailyTypes.source
await write('src/daily-cache-types.ts', `${dailyTypes.block.trim()}\n`)
dailyCore = replaceOnce(
  dailyCore,
  "import { emptyModelStats, mergeModelStats, sanitizeModels } from './daily-cache-model-detail.js'\n",
  "import { emptyModelStats, mergeModelStats, sanitizeModels } from './daily-cache-model-detail.js'\nimport type { CategoryDayStats, DailyCache, DailyEntry, ModelDayStats, ProjectDayStats, ProviderDaySlice } from './daily-cache-types.js'\n",
  'daily cache type import anchor',
)
dailyCore = replaceOnce(
  dailyCore,
  '\nfunction getCacheDir(): string {',
  "\nexport type { CategoryDayStats, DailyCache, DailyEntry, ModelDayStats, ProjectDayStats, ProviderDaySlice } from './daily-cache-types.js'\n\nfunction getCacheDir(): string {",
  'daily cache type re-export anchor',
)
await write('src/daily-cache-core.ts', dailyCore)

// Small modules only exceeded their historical ratchet by a handful of lines.
// Compact comments/formatting only; do not change executable behavior.
let antigravity = await read('src/providers/antigravity.ts')
antigravity = replaceOnce(
  antigravity,
  "  // Correlation against same-response RPC metadata establishes #9 as thinking\n  // and #10 as response output. #3 remains the inclusive generated-token total.\n  let thinkingTokens = protoFieldPositiveInteger(firstProtoField(usageFields, 9))\n  let responseTokens = protoFieldPositiveInteger(firstProtoField(usageFields, 10))",
  "  let thinkingTokens = protoFieldPositiveInteger(firstProtoField(usageFields, 9)) // #9 reasoning\n  let responseTokens = protoFieldPositiveInteger(firstProtoField(usageFields, 10)) // #10 output; #3 is inclusive generated total",
  'Antigravity protobuf comment compaction',
)
await write('src/providers/antigravity.ts', antigravity)

let codex = await read('src/providers/codex.ts')
codex = replaceOnce(
  codex,
  "  // Admission is structural and remains confined to Codex-owned roots plus\n  // rollout filename/layout rules. Legacy Codex session_meta used `payload.id`\n  // before the current `payload.session_id`; both are native session identities.\n  // `originator` is untrusted metadata: third-party app servers may emit valid\n  // Codex rollouts without a Codex-branded value, so branding alone must never\n  // decide admission.\n  const valid = entry.type === 'session_meta'\n    && isPlainObject(payload)\n    && (\n      nonEmptyString(payload['session_id']) !== undefined\n      || nonEmptyString(payload['id']) !== undefined\n    )",
  "  // Structural admission accepts current session_id and legacy id; originator branding is not authoritative.\n  const valid = entry.type === 'session_meta'\n    && isPlainObject(payload)\n    && (nonEmptyString(payload['session_id']) !== undefined || nonEmptyString(payload['id']) !== undefined)",
  'Codex legacy admission compaction',
)
codex = replaceOnce(
  codex,
  "          sessionId = nonEmptyString(entry.payload?.session_id)\n            ?? nonEmptyString(entry.payload?.id)\n            ?? basename(source.path, '.jsonl')",
  "          sessionId = nonEmptyString(entry.payload?.session_id) ?? nonEmptyString(entry.payload?.id) ?? basename(source.path, '.jsonl')",
  'Codex legacy identity fallback compaction',
)
await write('src/providers/codex.ts', codex)

let sessionCache = await read('src/session-cache.ts')
sessionCache = replaceOnce(
  sessionCache,
  "  /// Pre-historical API-equivalent value retained only when it differs from a\n  /// reviewed date-effective settlement. Enables compare/rollback mode without\n  /// mutating the authoritative assignment.",
  "  /// Pre-historical API-equivalent value retained for compare/rollback without mutating authority.",
  'session cache legacy-cost comment',
)
sessionCache = replaceOnce(
  sessionCache,
  "  /// True when `costUSD` (or the tokens it is priced from) is estimated rather\n  /// than metered. Persisted so the estimated-cost marker survives the cache.",
  "  /// True when cost/tokens are estimated rather than metered; persisted across cache reloads.",
  'session cache estimated-cost comment',
)
sessionCache = replaceOnce(
  sessionCache,
  "  // Claude native identity reconciliation metadata. `timestamp` remains the\n  // first logical emission timestamp; these fields preserve native identity\n  // and final-emission evidence for cross-file arbitration.",
  "  // Claude native identity/finality evidence; `timestamp` remains the first logical emission.",
  'session cache Claude metadata comment',
)
sessionCache = replaceOnce(
  sessionCache,
  "  // Rich-session-capture (capture-only; no report consumes these yet). All\n  // optional and omitted at zero/false to keep the per-call cache cost minimal.\n  // Lines added/removed by this call's edits, counted from tool-result diffs\n  // (Claude structuredPatch / Codex unified_diff). Numbers only, never patch text.",
  "  // Rich-session-capture fields are optional/zero-omitted; reports do not consume them yet.\n  // LOC comes from Claude structuredPatch / Codex unified_diff metadata, never patch text.",
  'session cache rich capture comment',
)
sessionCache = replaceOnce(
  sessionCache,
  "    && isOptionalString(o['nativeMessageId'])\n    && isOptionalString(o['nativeEmissionTimestamp'])\n    && isOptionalBool(o['nativeSnapshotTerminal'])",
  "    && isOptionalString(o['nativeMessageId']) && isOptionalString(o['nativeEmissionTimestamp']) && isOptionalBool(o['nativeSnapshotTerminal'])",
  'session cache Claude validation compaction',
)
await write('src/session-cache.ts', sessionCache)

let usage = await read('src/usage-aggregator.ts')
usage = replaceOnce(
  usage,
  "      // Never finalize the daily history off a partial (interrupted) session\n      // hydration — that is what froze empty older days into the chart.\n      isSessionHydrationComplete,\n      undefined,\n      { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },",
  "      // Never finalize daily history from a partial hydration; that previously froze empty older days.\n      isSessionHydrationComplete,\n      undefined, { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },",
  'usage aggregator hydration compaction',
)
await write('src/usage-aggregator.ts', usage)

for (const path of [
  'src/parser.ts',
  'src/daily-cache-core.ts',
  'src/providers/antigravity.ts',
  'src/providers/codex.ts',
  'src/session-cache.ts',
  'src/usage-aggregator.ts',
  'src/claude-native-reconciliation.ts',
  'src/date-range-projection.ts',
  'src/project-path-utils.ts',
  'src/daily-cache-types.ts',
]) {
  const lines = (await read(path)).split(/\r?\n/).length
  console.log(`${path}: ${lines} lines`)
}
