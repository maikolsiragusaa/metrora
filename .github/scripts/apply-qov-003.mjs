import { readFileSync, writeFileSync, rmSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content)
}

function replaceOnce(content, before, after, path) {
  const first = content.indexOf(before)
  if (first < 0) throw new Error(`${path}: expected fragment not found:\n${before.slice(0, 180)}`)
  if (content.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected fragment is not unique`)
  }
  return content.slice(0, first) + after + content.slice(first + before.length)
}

function update(path, transforms) {
  let content = read(path)
  for (const [before, after] of transforms) content = replaceOnce(content, before, after, path)
  write(path, content)
}

update('src/providers/types.ts', [
  [
    "import type { DateRange, ToolCall } from '../types.js'\n",
    "import type { DateRange, ToolCall } from '../types.js'\nimport type { ReasoningLevel, ReasoningLevelSource } from '../reasoning-level.js'\n",
  ],
  [
    "export type ParsedProviderCall = {\n  provider: string\n  model: string\n",
    "export type ParsedProviderCall = {\n  provider: string\n  model: string\n  reasoningLevel?: ReasoningLevel\n  reasoningLevelSource?: ReasoningLevelSource\n",
  ],
])

update('src/types.ts', [
  [
    'export type TokenUsage = {\n',
    "import type { ReasoningLevel, ReasoningLevelSource, ReasoningMix } from './reasoning-level.js'\n\nexport type TokenUsage = {\n",
  ],
  [
    "export type ParsedApiCall = {\n  provider: string\n  model: string\n",
    "export type ParsedApiCall = {\n  provider: string\n  model: string\n  reasoningLevel?: ReasoningLevel\n  reasoningLevelSource?: ReasoningLevelSource\n",
  ],
  [
    '  apiCalls: number\n  turns: ClassifiedTurn[]\n',
    '  apiCalls: number\n  reasoningMix?: ReasoningMix\n  turns: ClassifiedTurn[]\n',
  ],
])

update('src/providers/codex.ts', [
  [
    "import { estimateTokensFromChars } from '../token-estimate.js'\nimport type { ToolCall } from '../types.js'\n",
    "import { estimateTokensFromChars } from '../token-estimate.js'\nimport { findExplicitReasoningLevel, reasoningLevelFromModelLabel, type ReasoningLevel } from '../reasoning-level.js'\nimport type { ToolCall } from '../types.js'\n",
  ],
  [
    "    model?: string\n    name?: string\n",
    "    model?: string\n    reasoning_effort?: string\n    name?: string\n",
  ],
  [
    "function getRawJsonNumberField(head: string, field: string): number | undefined {\n",
    "function getRawReasoningEffort(head: string): string | undefined {\n  for (const field of [\n    'reasoning_effort',\n    'reasoningEffort',\n    'model_reasoning_effort',\n    'modelReasoningEffort',\n    'thinking_effort',\n    'thinkingEffort',\n    'effort',\n  ]) {\n    const value = getRawJsonStringField(head, field)\n    if (value) return value\n  }\n  return undefined\n}\n\nfunction getRawJsonNumberField(head: string, field: string): number | undefined {\n",
  ],
  [
    "  const compactModelName = getRawJsonStringField(pHead, 'model_name')\n  const compactLastUsage = getRawTokenUsage(pHead, 'last_token_usage')\n",
    "  const compactModelName = getRawJsonStringField(pHead, 'model_name')\n  const compactReasoningEffort = getRawReasoningEffort(pHead)\n  const compactLastUsage = getRawTokenUsage(pHead, 'last_token_usage')\n",
  ],
  [
    "      model: getRawJsonStringField(pHead, 'model'),\n      name: getRawJsonStringField(pHead, 'name'),\n",
    "      model: getRawJsonStringField(pHead, 'model'),\n      reasoning_effort: compactReasoningEffort,\n      name: getRawJsonStringField(pHead, 'name'),\n",
  ],
  [
    "function createParser(source: SessionSource, seenKeys: Set<string>): SessionParser {\n",
    "function reasoningMetadata(\n  model: string,\n  explicit?: ReasoningLevel,\n): Pick<ParsedProviderCall, 'reasoningLevel' | 'reasoningLevelSource'> {\n  if (explicit) return { reasoningLevel: explicit, reasoningLevelSource: 'explicit' }\n  const inferred = reasoningLevelFromModelLabel(model)\n  return inferred\n    ? { reasoningLevel: inferred.level, reasoningLevelSource: inferred.source }\n    : {}\n}\n\nfunction createParser(source: SessionSource, seenKeys: Set<string>): SessionParser {\n",
  ],
  [
    "      let sessionModel: string | undefined\n      let sessionId = ''\n",
    "      let sessionModel: string | undefined\n      let currentExplicitReasoning: ReasoningLevel | undefined\n      let sessionId = ''\n",
  ],
  [
    "          sessionModel = entry.payload?.model ?? sessionModel\n          continue\n        }\n\n        if (entry.type === 'turn_context' && entry.payload?.model) {\n          sessionModel = entry.payload.model\n          continue\n        }\n",
    "          sessionModel = entry.payload?.model ?? sessionModel\n          const explicit = findExplicitReasoningLevel(entry.payload)\n          if (explicit) currentExplicitReasoning = explicit\n          continue\n        }\n\n        if (entry.type === 'turn_context') {\n          const previousModel = sessionModel\n          if (entry.payload?.model) sessionModel = entry.payload.model\n          const explicit = findExplicitReasoningLevel(entry.payload)\n          if (explicit) currentExplicitReasoning = explicit\n          else if (entry.payload?.model && previousModel && entry.payload.model !== previousModel) {\n            currentExplicitReasoning = undefined\n          }\n          continue\n        }\n",
  ],
  [
    "              provider: 'codex',\n              model,\n              inputTokens: estInput,\n",
    "              provider: 'codex',\n              model,\n              ...reasoningMetadata(model, currentExplicitReasoning),\n              inputTokens: estInput,\n",
  ],
  [
    "            provider: 'codex',\n            model,\n            inputTokens: uncachedInputTokens,\n",
    "            provider: 'codex',\n            model,\n            ...reasoningMetadata(model, currentExplicitReasoning),\n            inputTokens: uncachedInputTokens,\n",
  ],
])

update('src/parser.ts', [
  [
    "import { calculateCost, calculateLocalModelSavings, getShortModelName, isProxiedPath, getProxyPathsConfigHash } from './models.js'\n",
    "import { calculateCost, calculateLocalModelSavings, getShortModelName, isProxiedPath, getProxyPathsConfigHash } from './models.js'\nimport { buildReasoningMix, reasoningLevelFromModelLabel, type ReasoningMixInput } from './reasoning-level.js'\n",
  ],
  [
    "function applyLocalModelSavings(call: ParsedApiCall): ParsedApiCall {\n  const u = call.usage\n  const savings = calculateLocalModelSavings(\n    call.model,\n    u.inputTokens,\n    u.outputTokens,\n    u.cacheCreationInputTokens,\n    u.cacheReadInputTokens,\n    u.webSearchRequests,\n    call.speed,\n    call.cacheCreationOneHourTokens ?? 0,\n  )\n  if (!savings) return call\n  return {\n    ...call,\n    costUSD: 0,\n    savingsUSD: savings.savingsUSD,\n    savingsBaselineModel: savings.baselineModel,\n    isLocalSavings: true,\n  }\n}\n",
    "function applyLocalModelSavings(call: ParsedApiCall): ParsedApiCall {\n  const inferred = call.reasoningLevel ? null : reasoningLevelFromModelLabel(call.model)\n  const attributed: ParsedApiCall = inferred\n    ? { ...call, reasoningLevel: inferred.level, reasoningLevelSource: inferred.source }\n    : call\n  const u = attributed.usage\n  const savings = calculateLocalModelSavings(\n    attributed.model,\n    u.inputTokens,\n    u.outputTokens,\n    u.cacheCreationInputTokens,\n    u.cacheReadInputTokens,\n    u.webSearchRequests,\n    attributed.speed,\n    attributed.cacheCreationOneHourTokens ?? 0,\n  )\n  if (!savings) return attributed\n  return {\n    ...attributed,\n    costUSD: 0,\n    savingsUSD: savings.savingsUSD,\n    savingsBaselineModel: savings.baselineModel,\n    isLocalSavings: true,\n  }\n}\n",
  ],
  [
    "  const apiCall: ParsedApiCall = applyLocalModelSavings({\n    provider: call.provider,\n    model: call.model,\n    usage,\n",
    "  const apiCall: ParsedApiCall = applyLocalModelSavings({\n    provider: call.provider,\n    model: call.model,\n    ...(call.reasoningLevel ? {\n      reasoningLevel: call.reasoningLevel,\n      reasoningLevelSource: call.reasoningLevelSource,\n    } : {}),\n    usage,\n",
  ],
  [
    "  const subagentBreakdown: SessionSummary['subagentBreakdown'] = Object.create(null)\n\n  let totalCost = 0\n",
    "  const subagentBreakdown: SessionSummary['subagentBreakdown'] = Object.create(null)\n  const reasoningCalls: ReasoningMixInput[] = []\n\n  let totalCost = 0\n",
  ],
  [
    "      totalCacheWrite += call.usage.cacheCreationInputTokens\n      apiCalls++\n\n      const modelKey = call.provider === 'devin' ? call.model : getShortModelName(call.model)\n",
    "      totalCacheWrite += call.usage.cacheCreationInputTokens\n      apiCalls++\n      reasoningCalls.push({\n        reasoningLevel: call.reasoningLevel,\n        reasoningLevelSource: call.reasoningLevelSource,\n        outputTokens: call.usage.outputTokens,\n        reasoningTokens: call.usage.reasoningTokens,\n        costUSD: call.costUSD,\n      })\n\n      const modelKey = call.provider === 'devin' ? call.model : getShortModelName(call.model)\n",
  ],
  [
    "    apiCalls,\n    turns,\n",
    "    apiCalls,\n    reasoningMix: buildReasoningMix(reasoningCalls),\n    turns,\n",
  ],
  [
    "function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {\n  return {\n    provider: call.provider,\n    model: call.model,\n    usage: {\n",
    "function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {\n  return {\n    provider: call.provider,\n    model: call.model,\n    ...(call.reasoningLevel ? {\n      reasoningLevel: call.reasoningLevel,\n      reasoningLevelSource: call.reasoningLevelSource,\n    } : {}),\n    usage: {\n",
  ],
  [
    "    provider: call.provider,\n    model: call.model,\n    usage: { ...call.usage, cacheCreationOneHourTokens: call.cacheCreationOneHourTokens ?? 0 },\n",
    "    provider: call.provider,\n    model: call.model,\n    ...(call.reasoningLevel ? {\n      reasoningLevel: call.reasoningLevel,\n      reasoningLevelSource: call.reasoningLevelSource,\n    } : {}),\n    usage: { ...call.usage, cacheCreationOneHourTokens: call.cacheCreationOneHourTokens ?? 0 },\n",
  ],
  [
    "    provider: call.provider,\n    model: call.model,\n    usage: {\n      inputTokens: u.inputTokens,\n",
    "    provider: call.provider,\n    model: call.model,\n    ...(call.reasoningLevel ? {\n      reasoningLevel: call.reasoningLevel,\n      reasoningLevelSource: call.reasoningLevelSource,\n    } : {}),\n    usage: {\n      inputTokens: u.inputTokens,\n",
  ],
])

update('src/session-cache.ts', [
  [
    "import type { ToolCall } from './types.js'\n",
    "import type { ReasoningLevel, ReasoningLevelSource } from './reasoning-level.js'\nimport type { ToolCall } from './types.js'\n",
  ],
  [
    "export type CachedCall = {\n  provider: string\n  model: string\n",
    "export type CachedCall = {\n  provider: string\n  model: string\n  reasoningLevel?: ReasoningLevel\n  reasoningLevelSource?: ReasoningLevelSource\n",
  ],
  [
    "  codex: 'mcp-attribution-v5-est-cost-active-timing-mcp-wait-rich-capture-v1-cross-provider-pr-v1',\n",
    "  codex: 'mcp-attribution-v5-est-cost-active-timing-mcp-wait-rich-capture-v1-cross-provider-pr-v1-reasoning-attribution-v1',\n",
  ],
])

update('src/codex-cache.ts', [
  [
    "// v8: persist native MCP timing and compact invocation attribution.\nconst CODEX_CACHE_VERSION = 8\n",
    "// v8: persist native MCP timing and compact invocation attribution.\n// v9: persist explicit per-call reasoning attribution from turn_context.\nconst CODEX_CACHE_VERSION = 9\n",
  ],
])

update('src/sessions-report.ts', [
  [
    "import type { ProjectSummary, SessionSummary, TaskCategory } from './types.js'\n",
    "import type { ReasoningMix } from './reasoning-level.js'\nimport type { ProjectSummary, SessionSummary, TaskCategory } from './types.js'\n",
  ],
  [
    "  cacheReadTokens: number\n  cacheWriteTokens: number\n  startedAt: string\n",
    "  cacheReadTokens: number\n  cacheWriteTokens: number\n  reasoningTokens: number\n  reasoningMix?: ReasoningMix\n  startedAt: string\n",
  ],
  [
    "    cacheReadTokens: session.totalCacheReadTokens,\n    cacheWriteTokens: session.totalCacheWriteTokens,\n    startedAt: session.firstTimestamp,\n",
    "    cacheReadTokens: session.totalCacheReadTokens,\n    cacheWriteTokens: session.totalCacheWriteTokens,\n    ...(session.reasoningMix ? {\n      reasoningTokens: session.totalReasoningTokens,\n      reasoningMix: session.reasoningMix,\n    } : {}),\n    startedAt: session.firstTimestamp,\n",
  ],
])

update('app/renderer/lib/types.ts', [
  [
    '// Types mirrored verbatim from the codeburn CLI (`src/*`). The renderer is a\n',
    '// Types mirrored from the Qovrion CLI (`src/*`). The renderer is a\n',
  ],
  [
    "// ————— src/sessions-report.ts —————\nexport type SessionRow = {\n",
    "// ————— src/reasoning-level.ts + src/sessions-report.ts —————\nexport type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'adaptive'\nexport type ReasoningLevelOrUnknown = ReasoningLevel | 'unknown'\nexport type ReasoningLevelSource = 'explicit' | 'model-label'\nexport type ReasoningMix = {\n  totalCalls: number\n  knownCalls: number\n  coverage: number\n  rows: Array<{\n    level: ReasoningLevelOrUnknown\n    calls: number\n    callShare: number\n    generatedTokens: number\n    reasoningTokens: number\n    costUSD: number\n    sources: ReasoningLevelSource[]\n  }>\n}\n\nexport type SessionRow = {\n",
  ],
  [
    "  cacheReadTokens: number\n  cacheWriteTokens: number\n  startedAt: string\n",
    "  cacheReadTokens: number\n  cacheWriteTokens: number\n  reasoningTokens?: number\n  reasoningMix?: ReasoningMix\n  startedAt: string\n",
  ],
])

update('app/renderer/sections/Sessions.tsx', [
  [
    "import type { DateRange, Period, SessionRow } from '../lib/types'\n",
    "import type { DateRange, Period, ReasoningMix, ReasoningLevelOrUnknown, SessionRow } from '../lib/types'\n",
  ],
  [
    "function endedAtTime(row: SessionRow): number {\n",
    "const REASONING_LABELS: Record<ReasoningLevelOrUnknown, string> = {\n  none: 'None',\n  minimal: 'Minimal',\n  low: 'Low',\n  medium: 'Medium',\n  high: 'High',\n  xhigh: 'XHigh',\n  max: 'Max',\n  adaptive: 'Adaptive',\n  unknown: 'Unknown',\n}\n\nexport function reasoningMixLabel(mix?: ReasoningMix): string {\n  if (!mix || mix.totalCalls === 0 || mix.rows.length === 0) return 'Unknown'\n  const rows = mix.rows.filter(row => row.calls > 0)\n  if (rows.length === 1 && rows[0]!.callShare === 1) return REASONING_LABELS[rows[0]!.level]\n  const visible = rows.slice(0, 2).map(row =>\n    `${REASONING_LABELS[row.level]} ${Math.round(row.callShare * 100)}%`\n  )\n  if (rows.length > 2) visible.push(`+${rows.length - 2}`)\n  return visible.join(' · ')\n}\n\nfunction reasoningCoverageLabel(mix?: ReasoningMix): string {\n  if (!mix || mix.totalCalls === 0) return 'No attributed calls'\n  return `${mix.knownCalls.toLocaleString('en-US')} of ${mix.totalCalls.toLocaleString('en-US')} calls known · ${Math.round(mix.coverage * 100)}% coverage`\n}\n\nfunction endedAtTime(row: SessionRow): number {\n",
  ],
  [
    "    row.models.join(' '),\n  ].some(value => value.toLowerCase().includes(q)))\n",
    "    row.models.join(' '),\n    row.reasoningMix?.rows.map(item => item.level).join(' ') ?? '',\n  ].some(value => value.toLowerCase().includes(q)))\n",
  ],
  [
    "                  <span className=\"session-models\">{entry.row.models.join(', ')}</span>\n",
    "                  <span className=\"session-models\">\n                    <span className=\"session-model-list\">{entry.row.models.join(', ')}</span>\n                    <span className=\"session-reasoning-mix\">{reasoningMixLabel(entry.row.reasoningMix)}</span>\n                  </span>\n",
  ],
  [
    "        <div className=\"detail-line\">{session.provider} · {session.models.join(', ')}</div>\n",
    "        <div className=\"detail-line\">{session.provider} · {session.models.join(', ')}</div>\n        <div className=\"detail-line\">Reasoning · {reasoningMixLabel(session.reasoningMix)} · {reasoningCoverageLabel(session.reasoningMix)}</div>\n",
  ],
  [
    "      <div className=\"stats\">\n        <Stat label=\"Cost\" value={formatUsd(session.cost)} delta=\"this session\" />\n",
    "      <div className=\"stats\">\n        <Stat label=\"Cost\" value={formatUsd(session.cost)} delta=\"this session\" />\n",
  ],
  [
    "        <Stat label=\"Cache write\" value={formatCompact(session.cacheWriteTokens)} delta=\"tokens cached\" />\n      </div>\n    </div>\n",
    "        <Stat label=\"Cache write\" value={formatCompact(session.cacheWriteTokens)} delta=\"tokens cached\" />\n      </div>\n      {session.reasoningMix && session.reasoningMix.rows.length > 0 && (\n        <div className=\"reasoning-detail\">\n          <div className=\"reasoning-detail-head\">\n            <span>Reasoning mix by API call</span>\n            <span>{formatCompact(session.reasoningTokens ?? 0)} dedicated reasoning tokens</span>\n          </div>\n          <div className=\"reasoning-detail-rows\">\n            {session.reasoningMix.rows.map(row => (\n              <div className=\"reasoning-detail-row\" key={row.level}>\n                <span className=\"reasoning-detail-label\">{REASONING_LABELS[row.level]}</span>\n                <span className=\"reasoning-detail-track\"><span style={{ width: `${Math.max(2, row.callShare * 100)}%` }} /></span>\n                <span className=\"reasoning-detail-value\">\n                  {Math.round(row.callShare * 100)}% · {row.calls.toLocaleString('en-US')} calls · {formatCompact(row.reasoningTokens)} reasoning\n                </span>\n              </div>\n            ))}\n          </div>\n        </div>\n      )}\n    </div>\n",
  ],
])

update('app/renderer/styles/plain.css', [
  [
    '.session-models { text-align: right; }\n',
    ".session-models { display: flex; min-width: 0; flex-direction: column; align-items: flex-end; text-align: right; }\n.session-model-list { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }\n.session-reasoning-mix { max-width: 100%; overflow: hidden; margin-top: 2px; color: var(--accent-text); font-size: 10px; font-weight: 600; text-overflow: ellipsis; }\n",
  ],
  [
    '.detail-line { color: var(--mut); font-size: 12px; font-variant-numeric: tabular-nums; }\n',
    ".detail-line { color: var(--mut); font-size: 12px; font-variant-numeric: tabular-nums; }\n.reasoning-detail { padding: 12px 14px; border: 1px solid var(--line2); border-radius: 9px; background: var(--panel); }\n.reasoning-detail-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--mut); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }\n.reasoning-detail-rows { display: grid; gap: 7px; }\n.reasoning-detail-row { display: grid; grid-template-columns: 68px minmax(80px, 1fr) minmax(190px, auto); align-items: center; gap: 9px; font-size: 11px; font-variant-numeric: tabular-nums; }\n.reasoning-detail-label { color: var(--ink); font-weight: 600; }\n.reasoning-detail-track { height: 6px; overflow: hidden; border-radius: 999px; background: var(--bar); }\n.reasoning-detail-track > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }\n.reasoning-detail-value { color: var(--mut2); text-align: right; }\n",
  ],
])

update('tests/cli-emitters.test.ts', [
  [
    "        'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',\n        'startedAt', 'endedAt', 'durationMs',\n",
    "        'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',\n        'reasoningTokens', 'reasoningMix',\n        'startedAt', 'endedAt', 'durationMs',\n",
  ],
  [
    "      expect(rows.every(row => row.provider === 'claude')).toBe(true)\n",
    "      expect(rows.every(row => row.provider === 'claude')).toBe(true)\n      expect(rows.every(row => typeof row.reasoningTokens === 'number')).toBe(true)\n      expect(rows.every(row => {\n        const mix = row.reasoningMix as { totalCalls?: number; rows?: Array<{ level?: string }> } | undefined\n        return mix?.totalCalls === row.calls && mix.rows?.some(item => item.level === 'unknown')\n      })).toBe(true)\n",
  ],
])

update('README.md', [
  [
    'The runtime command remains `codeburn` until the compatibility-safe rebranding work is completed. Do not publish packages or binaries under the Qovrion name without an explicit release change.\n',
    'The canonical runtime command is `qovrion`; `codeburn` remains a temporary compatibility alias. There are still no official Qovrion packages or binaries, so do not publish or distribute artifacts without an explicit release change.\n',
  ],
])

write('src/providers/codex-reasoning.test.ts', `import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'\nimport { tmpdir } from 'node:os'\nimport { join } from 'node:path'\nimport { afterEach, describe, expect, it } from 'vitest'\n\nimport { createCodexProvider } from './codex.js'\n\nlet root: string | undefined\nconst savedCacheDir = process.env.CODEBURN_CACHE_DIR\n\nafterEach(async () => {\n  if (savedCacheDir === undefined) delete process.env.CODEBURN_CACHE_DIR\n  else process.env.CODEBURN_CACHE_DIR = savedCacheDir\n  if (root) await rm(root, { recursive: true, force: true })\n  root = undefined\n})\n\nfunction usage(input: number, cached: number, output: number, reasoning: number) {\n  return {\n    input_tokens: input,\n    cached_input_tokens: cached,\n    output_tokens: output,\n    reasoning_output_tokens: reasoning,\n    total_tokens: input + output + reasoning,\n  }\n}\n\ndescribe('Codex reasoning attribution', () => {\n  it('preserves effort changes per call, including a large compact turn_context line', async () => {\n    root = await mkdtemp(join(tmpdir(), 'qovrion-codex-reasoning-'))\n    process.env.CODEBURN_CACHE_DIR = join(root, 'cache')\n    const day = join(root, 'sessions', '2026', '07', '31')\n    await mkdir(day, { recursive: true })\n    const file = join(day, 'rollout-2026-07-31T00-00-00-session.jsonl')\n\n    const first = usage(100, 20, 10, 5)\n    const second = usage(220, 40, 25, 8)\n    const lines = [\n      { timestamp: '2026-07-31T00:00:00.000Z', type: 'session_meta', payload: { originator: 'codex_cli_rs', session_id: 'session', cwd: root, model: 'gpt-5.6-sol' } },\n      { timestamp: '2026-07-31T00:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol', padding: 'x'.repeat(40_000), collaboration_mode: { settings: { reasoning_effort: 'high' } } } },\n      { timestamp: '2026-07-31T00:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5.6-sol', last_token_usage: first, total_token_usage: first } } },\n      { timestamp: '2026-07-31T00:00:03.000Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol', collaboration_mode: { settings: { reasoning_effort: 'low' } } } },\n      { timestamp: '2026-07-31T00:00:04.000Z', type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5.6-sol', last_token_usage: { ...second, input_tokens: 120, cached_input_tokens: 20, output_tokens: 15, reasoning_output_tokens: 3, total_tokens: 138 }, total_token_usage: second } } },\n    ]\n    await writeFile(file, lines.map(line => JSON.stringify(line)).join('\\n') + '\\n')\n\n    const provider = createCodexProvider(root)\n    const sources = await provider.discoverSessions()\n    expect(sources).toHaveLength(1)\n    const calls = []\n    for await (const call of provider.createSessionParser(sources[0]!, new Set()).parse()) calls.push(call)\n\n    expect(calls).toHaveLength(2)\n    expect(calls.map(call => [call.reasoningLevel, call.reasoningLevelSource])).toEqual([\n      ['high', 'explicit'],\n      ['low', 'explicit'],\n    ])\n    expect(calls.map(call => call.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol'])\n  })\n})\n`)

write('app/renderer/sections/Sessions.reasoning.test.ts', `// @vitest-environment jsdom\nimport { describe, expect, it } from 'vitest'\n\nimport { reasoningMixLabel } from './Sessions'\n\ndescribe('session reasoning mix label', () => {\n  it('shows a single complete level without noise', () => {\n    expect(reasoningMixLabel({\n      totalCalls: 3,\n      knownCalls: 3,\n      coverage: 1,\n      rows: [{ level: 'high', calls: 3, callShare: 1, generatedTokens: 100, reasoningTokens: 20, costUSD: 1, sources: ['explicit'] }],\n    })).toBe('High')\n  })\n\n  it('keeps unknown calls visible in a mixed session', () => {\n    expect(reasoningMixLabel({\n      totalCalls: 3,\n      knownCalls: 2,\n      coverage: 2 / 3,\n      rows: [\n        { level: 'high', calls: 2, callShare: 2 / 3, generatedTokens: 100, reasoningTokens: 20, costUSD: 1, sources: ['explicit'] },\n        { level: 'unknown', calls: 1, callShare: 1 / 3, generatedTokens: 40, reasoningTokens: 15, costUSD: 0.4, sources: [] },\n      ],\n    })).toBe('High 67% · Unknown 33%')\n  })\n})\n`)

rmSync('docs/.qov-003-placeholder', { force: true })
