import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const current = await readFile(path, 'utf8')
  if (current.includes(after)) return false
  const first = current.indexOf(before)
  if (first === -1) throw new Error(`${path}: expected source fragment not found`)
  if (current.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${path}: source fragment is not unique`)
  }
  await writeFile(path, current.slice(0, first) + after + current.slice(first + before.length))
  return true
}

const changes = []

changes.push(await replaceOnce(
  'src/providers/types.ts',
  "export type ParsedProviderCall = {\n  provider: string\n  model: string\n",
  "export type ParsedProviderCall = {\n  /** Collector/tool that produced the record (for example zed or opencode). */\n  provider: string\n  /** Model identifier recorded by the source. */\n  model: string\n  /**\n   * Actual model/API provider recorded explicitly by the source (for example\n   * anthropic, openai, google, or zed.dev). Never inferred from the collector\n   * name or model label. Omitted when the source does not expose it.\n   */\n  modelProvider?: string\n",
))

changes.push(await replaceOnce(
  'src/types.ts',
  "export type ParsedApiCall = {\n  provider: string\n  model: string\n",
  "export type ParsedApiCall = {\n  /** Collector/tool that produced the call. */\n  provider: string\n  model: string\n  /** Explicit source-recorded model/API provider; never inferred. */\n  modelProvider?: string\n",
))

changes.push(await replaceOnce(
  'src/session-cache.ts',
  "export type CachedCall = {\n  provider: string\n  model: string\n",
  "export type CachedCall = {\n  provider: string\n  model: string\n  /** Explicit model/API provider preserved from the source when available. */\n  modelProvider?: string\n",
))

changes.push(await replaceOnce(
  'src/session-cache.ts',
  "  antigravity: 'worktree-project-grouping-v5',\n}",
  "  antigravity: 'worktree-project-grouping-v5',\n  // Preserve the source-recorded thread.model.provider through the shared cache.\n  zed: 'sqlite-zstd-ledger-v1-model-provider-v1',\n}",
))

changes.push(await replaceOnce(
  'src/parser.ts',
  "function providerCallToTurn(call: ParsedProviderCall): ParsedTurn {",
  "export function providerCallToTurn(call: ParsedProviderCall): ParsedTurn {",
))
changes.push(await replaceOnce(
  'src/parser.ts',
  "function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {",
  "export function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {",
))
changes.push(await replaceOnce(
  'src/parser.ts',
  "function apiCallToCachedCall(call: ParsedApiCall): CachedCall {",
  "export function apiCallToCachedCall(call: ParsedApiCall): CachedCall {",
))
changes.push(await replaceOnce(
  'src/parser.ts',
  "function cachedCallToApiCall(call: CachedCall): ParsedApiCall {",
  "export function cachedCallToApiCall(call: CachedCall): ParsedApiCall {",
))

changes.push(await replaceOnce(
  'src/parser.ts',
  "  const apiCall: ParsedApiCall = applyLocalModelSavings({\n    provider: call.provider,\n    model: call.model,\n",
  "  const apiCall: ParsedApiCall = applyLocalModelSavings({\n    provider: call.provider,\n    model: call.model,\n    ...(call.modelProvider ? { modelProvider: call.modelProvider } : {}),\n",
))

changes.push(await replaceOnce(
  'src/parser.ts',
  "export function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {\n  return {\n    provider: call.provider,\n    model: call.model,\n",
  "export function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {\n  return {\n    provider: call.provider,\n    model: call.model,\n    ...(call.modelProvider ? { modelProvider: call.modelProvider } : {}),\n",
))

changes.push(await replaceOnce(
  'src/parser.ts',
  "export function apiCallToCachedCall(call: ParsedApiCall): CachedCall {\n  return {\n    provider: call.provider,\n    model: call.model,\n",
  "export function apiCallToCachedCall(call: ParsedApiCall): CachedCall {\n  return {\n    provider: call.provider,\n    model: call.model,\n    ...(call.modelProvider ? { modelProvider: call.modelProvider } : {}),\n",
))

changes.push(await replaceOnce(
  'src/parser.ts',
  "  return applyLocalModelSavings({\n    provider: call.provider,\n    model: call.model,\n    ...(call.reasoningLevel ? {\n",
  "  return applyLocalModelSavings({\n    provider: call.provider,\n    model: call.model,\n    ...(call.modelProvider ? { modelProvider: call.modelProvider } : {}),\n    ...(call.reasoningLevel ? {\n",
))

changes.push(await replaceOnce(
  'src/providers/zed.ts',
  "import { calculateCost } from '../models.js'\n",
  "import { calculateCost } from '../models.js'\nimport { normalizeExplicitModelProvider } from '../model-provider.js'\n",
))

changes.push(await replaceOnce(
  'src/providers/zed.ts',
  "  usage: TokenUsage\n  model: string\n  timestamp: string\n",
  "  usage: TokenUsage\n  model: string\n  modelProvider?: string\n  timestamp: string\n",
))

changes.push(await replaceOnce(
  'src/providers/zed.ts',
  "    provider: 'zed',\n    model: opts.model,\n",
  "    provider: 'zed',\n    model: opts.model,\n    ...(opts.modelProvider ? { modelProvider: opts.modelProvider } : {}),\n",
))

changes.push(await replaceOnce(
  'src/providers/zed.ts',
  "      const model = thread.model?.model || 'unknown'\n      const userMessage = row.summary ?? ''\n",
  "      const model = thread.model?.model || 'unknown'\n      const modelProvider = normalizeExplicitModelProvider(thread.model?.provider)\n      const userMessage = row.summary ?? ''\n",
))

changes.push(await replaceOnce(
  'src/providers/zed.ts',
  "        const call = buildCall({ threadId: row.id, requestKey, usage, model, timestamp, userMessage })\n",
  "        const call = buildCall({ threadId: row.id, requestKey, usage, model, modelProvider, timestamp, userMessage })\n",
))

if (!changes.some(Boolean)) {
  console.log('model-provider foundation already applied')
} else {
  console.log(`applied ${changes.filter(Boolean).length} guarded replacements`)
}
