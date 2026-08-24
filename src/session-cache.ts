import { readFile, stat, open, rename, unlink, readdir, mkdir } from 'fs/promises'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { createHash, randomBytes } from 'crypto'
import { join } from 'path'
import type { ReasoningLevel, ReasoningLevelSource } from './reasoning-level.js'
import type { ToolCall } from './types.js'
import type { CostAssignmentV1 } from './pricing/cost-assignment.js'
import { fingerprintSourceFile, type SQLiteWalFingerprint } from './sqlite-source-fingerprint.js'
import { getMetroraCacheDir } from './product-paths.js'
import { validateCachedFile, validateSessionCache } from './session-cache-validation.js'
import { rememberSessionCachePayloadEvidenceV1, writeSessionCacheGenerationFromPayloadV1 } from './cache-generation.js'
// ── Types ──────────────────────────────────────────────────────────────

export type CachedUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  webSearchRequests: number
  cacheCreationOneHourTokens: number
}

export type CachedCall = {
  provider: string
  model: string
  /** Explicit model/API provider preserved from the source when available. */
  modelProvider?: string; pricingContext?: import('./pricing/pricing-context.js').HistoricalPricingContextV1
  reasoningLevel?: ReasoningLevel
  reasoningLevelSource?: ReasoningLevelSource
  usage: CachedUsage
  costUSD?: number
  /// Immutable basis for `costUSD`. `unavailable` carries no stored numeric
  /// amount; the query layer may still display 0 while preserving that it is not
  /// an intentional free route.
  costAssignment?: CostAssignmentV1
  /// Pre-historical API-equivalent value retained for compare/rollback without mutating authority.
  legacyCostUSD?: number
  /// True when cost/tokens are estimated rather than metered; persisted across cache reloads.
  isEstimated?: boolean
  speed: 'standard' | 'fast'
  timestamp: string
  tools: string[]
  bashCommands: string[]
  skills: string[]
  subagentTypes: string[]
  deduplicationKey: string
  project?: string
  projectPath?: string
  workingDirectory?: string
  toolSequence?: ToolCall[][]
  // Claude native identity/finality evidence; `timestamp` remains the first logical emission.
  nativeMessageId?: string
  nativeEmissionTimestamp?: string
  nativeSnapshotTerminal?: boolean
  // Rich-session-capture fields are optional/zero-omitted; reports do not consume them yet.
  // LOC comes from Claude structuredPatch / Codex unified_diff metadata, never patch text.
  locAdded?: number
  locRemoved?: number
  // True only. Claude: a tool result was interrupted / user-modified its edit.
  interrupted?: boolean
  userModified?: boolean
  // Claude: count of this call's tool results flagged is_error. Omitted at 0.
  toolErrors?: number
  // Codex: count of this call's patch applications with success === false.
  editFailed?: number
  activeDurationMs?: number
  activeGeneratedTokens?: number
  toolWaitMs?: number
} & import('./session-cache-token-authority.js').CachedCallTokenAuthority

export type CachedTurn = {
  timestamp: string
  sessionId: string
  userMessage: string
  calls: CachedCall[]
  // Claude: git branch for this turn, stored only when it differs from the
  // previous turn's branch (a report carries the last stored value forward).
  // Rich-session-capture; optional, Claude only.
  gitBranch?: string
  // GitHub PR URLs referenced during this turn, sorted and deduplicated. Claude
  // can provide native links; all providers can provide explicit URLs from the
  // saved user message. Stored directly so each turn's refs are self-contained.
  prRefs?: string[]
  // Claude: `tool_use` ids of the `Agent`/`Task` subagent spawns in this turn.
  // A spawned sidechain session is folded into the launching turn by matching its
  // resolved spawn id against these. Stored per-turn directly. Optional.
  spawnToolUseIds?: string[]
}

export type FileFingerprint = {
  dev: number
  ino: number
  mtimeMs: number
  sizeBytes: number
  /** Present only when a SQLite source has a live WAL sidecar. */
  sqliteWal?: SQLiteWalFingerprint
}

export type CachedFile = {
  fingerprint: FileFingerprint
  lastCompleteLineOffset?: number
  canonicalCwd?: string
  // Original cwd before linked-worktree canonicalization.
  workingDirectory?: string
  canonicalProjectName?: string
  mcpInventory: string[]
  turns: CachedTurn[]
  // Claude Code only: for a subagent transcript (`subagents/.../agent-*.jsonl`),
  // the `agentType` from its sibling `.meta.json` (e.g. `workflow-subagent`,
  // `Explore`, `general-purpose`). Drives the Claude-scoped agent-type breakdown.
  agentType?: string
  // Negative-result marker: this file threw while parsing at the recorded
  // fingerprint. Cached so we don't re-read + re-throw it on every refresh; it
  // is re-parsed only when the file changes (fingerprint differs). Carries no
  // turns, so it contributes no usage. (issue #441 follow-up)
  failed?: boolean
  // Rich-session-capture, Claude session-level (capture-only; no report yet).
  // `title` is the LAST `ai-title` entry's text; `prLinks` accumulates every
  // `pr-link` entry's URL. `isSidechain` is true when any entry is a sidechain:
  // parentUuid references an intra-file entry uuid, not another session id, so it
  // cannot link sessions — only the boolean marker is reliable. All optional.
  title?: string
  prLinks?: string[]
  isSidechain?: boolean
  // Subagent-attribution linkage (Claude only). On a SIDECHAIN file,
  // `parentSessionId` is the spawning session's id (the transcript's internal
  // `sessionId`). On a PARENT file, `agentSpawnLinks` maps each spawned subagent
  // id to the `tool_use` id of the `Agent`/`Task` block that launched it. Both
  // optional; a file is typically one or the other (a nested agent can be both).
  parentSessionId?: string
  agentSpawnLinks?: Record<string, string>
  // Parent file: agent ids whose spawn result named them but whose exact launching
  // tool_use could not be paired (ambiguous multi-result record). Drives a
  // grace-window fallback for a late child. Absent when no pairing was ambiguous.
  ambiguousSpawnAgentIds?: string[]
}

export type ProviderSection = {
  envFingerprint: string
  files: Record<string, CachedFile>
  /** True when the provider's cache entries survive source-file eviction. */
  durable?: boolean
}

export type SessionCache = {
  version: number
  providers: Record<string, ProviderSection>
  /** True only once a full scan has run to completion. The throttled partial
   *  saves during a cold hydration persist `false`; the single end-of-parse save
   *  flips it `true`. A cache that is present-but-incomplete (an interrupted cold
   *  start left a partial behind) must be treated as still cold — otherwise the
   *  emptiness heuristic reads the partial as warm, the cross-process hydration
   *  lock never engages, and totals heal only gradually while a concurrent parse
   *  can freeze a partial daily history. Absent on caches written before this
   *  field existed → read as incomplete (one self-healing re-hydration). */
  complete?: boolean
}

// ── Constants ──────────────────────────────────────────────────────────

// v5: kiro joined the costUSD pass-through allowlist (credit-based pricing).
// Cached kiro entries from v4 carry costUSD: undefined and would keep being
// re-priced from estimated tokens forever, since historical session files
// never change. Bump forces a one-time re-parse so metered credit costs land.
// v6: per-turn `prRefs` capture for turn-level PR spend attribution. Existing
// cache turns carry no prRefs; bumping forces a one-time re-parse so surviving
// transcripts populate the field. (Daily-cache versioning is untouched.)
// v7: sidechain->parent linkage - per-turn `spawnToolUseIds`, per-file
// `parentSessionId` / `agentSpawnLinks` - so subagent spend folds into the parent
// turn's PR set. v6 never shipped, so users cross v5->v7 in a single combined bump.
// v8: immutable per-call cost assignments. Present sources reparse and settle
// against reviewed history; durable and PR-bearing source-less entries are
// carried forward and conservatively assigned before publication.
// INVARIANT: a version bump must extend `PRIOR_CACHE_VERSIONS` (the adoption path
// below) to EVERY prior version that can still exist on disk, or expired-PR
// history from the immediately preceding build silently vanishes.
export const CACHE_VERSION = 8

// The cache filename is version-suffixed so different binaries (e.g. an old
// launchd menubar on a prior release and a newer desktop app) each own a
// distinct file and can never clobber each other's incompatible schema. Bumping
// CACHE_VERSION automatically mints a fresh filename, superseding the migration
// dance the legacy unversioned file used to need.
const CACHE_FILE = `session-cache.v${CACHE_VERSION}.json`
// The pre-versioning filename. Never written or deleted anymore — old binaries
// still own it. On first load we adopt-copy it once (see loadCache) when the
// versioned file is absent and the legacy file's version matches ours.
const LEGACY_CACHE_FILE = 'session-cache.json'
const TEMP_FILE_MAX_AGE_MS = 5 * 60 * 1000

export const PROVIDER_ENV_VARS: Record<string, string[]> = {
  claude: ['CLAUDE_CONFIG_DIRS', 'CLAUDE_CONFIG_DIR'],
  codewhale: ['CODEWHALE_HOME'],
  codex: ['CODEX_HOME'],
  hermes: ['HERMES_HOME'],
  'lingtai-tui': ['LINGTAI_HOME', 'LINGTAI_TUI_HOME', 'LINGTAI_TUI_GLOBAL_DIR'],
  droid: ['FACTORY_DIR'],
  cursor: ['XDG_DATA_HOME'],
  'cursor-agent': ['XDG_DATA_HOME'],
  opencode: ['XDG_DATA_HOME', 'OPENCODE_DATA_DIR', 'OPENCODE_DB_PREFIX'],
  goose: ['XDG_DATA_HOME'],
  crush: ['XDG_DATA_HOME'],
  warp: ['WARP_DB_PATH'],
  antigravity: ['METRORA_CACHE_DIR'],
  qwen: ['QWEN_DATA_DIR'],
  'ibm-bob': ['XDG_CONFIG_HOME'],
  quickdesk: ['QUICKWORK_HOME'],
  kimicode: ['KIMI_CODE_HOME'],
}

// Names of providers whose cache entries are never evicted when source files
// disappear — they are preserved so month-to-date totals never drop.
export const DURABLE_PROVIDER_NAMES: ReadonlySet<string> = new Set(['copilot', 'antigravity'])

// Estimated-cost surfacing (#639): providers that set `costIsEstimated` carry a
// `-est-cost` suffix (or a new entry) so their already-cached sessions reparse
// once and the flag lands, instead of silently reading as measured. Copilot
// needs no suffix: the cli-shutdown-cost-v1 bump below already forces its one
// re-parse, which lands the flag too. Durable orphans survive fingerprint
// changes through the present-source check in the parser.
export const PROVIDER_PARSE_VERSIONS: Record<string, string> = {
  // rich-session-capture-v1: parse-time capture of per-turn gitBranch, per-call
  // LOC deltas / interruptions / userModified / toolErrors, and session-level
  // title / prLinks / isSidechain. Forces one re-parse so cached sessions gain
  // the new optional fields.
  claude: 'advisor-usage-v1-skills-rich-capture-v1-cross-provider-pr-v1-native-id-reconciliation-v1',
  cline: 'worktree-project-grouping-v1-vscode-variants-v2-provider-zero-cost',
  codewhale: 'aggregate-session-v2-provider-provenance-pricing-evidence-v1',
  // Bump when the Codex parser changes attribution so unchanged, already-cached
  // session files re-parse (session-cache.json serves them without invoking the
  // provider parser otherwise). Covers native mcp_tool_call_end (#513) and
  // CLI-wrapped `mcp-cli call` (#478) MCP attribution.
  // rich-session-capture-v1: per-call LOC deltas + editFailed from
  // patch_apply_end. (The codex-results.json CODEX_CACHE_VERSION is bumped in
  // lockstep so the pre-session-cache layer re-parses too.)
  // session-meta-model-v1: direct payload.model only; nested provenance.model is metadata.
  codex: 'mcp-attribution-v5-est-cost-active-timing-mcp-wait-rich-capture-v1-cross-provider-pr-v1-reasoning-attribution-v1-pricing-context-tags-v1-pricing-evidence-provider-routes-v1-session-meta-model-v1',
  cursor: 'composer-anchored-crediting-v1-est-cost',
  'cursor-agent': 'workspaceless-transcript-v2-estimated-cost',
  copilot: 'cli-shutdown-cost-v3-source-provenance-otel-token-semantics-v1-reasoning-evidence-v1',
  goose: 'sqlite-session-v1-provider-provenance',
  grok: 'estimated-cost-v1-authoritative-turn-usage-v1',
  hermes: 'reasoning-output-accounting-v2-provider-provenance-cost-semantics-v2-pricing-evidence-v1',
  'lingtai-tui': 'token-ledger-registry-activity-v3',
  'ibm-bob': 'worktree-project-grouping-v1',
  kiro: 'ide-parsing-v3-provider-provenance',
  'mistral-vibe': 'session-cost-only-v1-provider-provenance-estimated-cost-v2',
  quickdesk: 'emf-sqlite-v2-est-cost-pricing-evidence-v1',
  kimicode: 'wire-usage-v1-est-cost',
  'kilo-code': 'worktree-project-grouping-v1',
  'roo-code': 'worktree-project-grouping-v1',
  zerostack: 'cumulative-session-v1-provider-provenance-estimated-cost-v2',
  warp: 'worktree-project-grouping-v1-est-cost',
  antigravity: 'worktree-project-grouping-v6-provider-reasoning-filter-usage-accounting-v2-source-union-v1-durable-v1-output-reasoning-map-v2-pricing-evidence-v1',
  // OpenCode keeps valid usage in archived root/child sessions. The parser
  // must scan the complete SQLite session tree, not only active sessions.
  opencode: 'sqlite-session-tree-v2-provider-id-v1-free-route-v1-route-cost-v1-pricing-context-v1',
  // Preserve the source-recorded thread.model.provider through the shared cache.
  zed: 'sqlite-zstd-ledger-v1-model-provider-v1-pricing-context-v1',
}
// ── Cache Dir ──────────────────────────────────────────────────────────
function getCacheDir(): string {
  return getMetroraCacheDir()
}
function getCachePath(): string {
  return join(getCacheDir(), CACHE_FILE)
}
function getLegacyCachePath(): string {
  return join(getCacheDir(), LEGACY_CACHE_FILE)
}

/** Absolute path of the active (version-suffixed) session cache file. */
export function sessionCachePath(): string {
  return getCachePath()
}

// ── Env Fingerprint ────────────────────────────────────────────────────

export function computeEnvFingerprint(provider: string): string {
  const vars = PROVIDER_ENV_VARS[provider] ?? []
  const parts = vars.map(v => `${v}=${process.env[v] ?? ''}`)
  const parseVersion = PROVIDER_PARSE_VERSIONS[provider]
  if (parseVersion) parts.push(`parser=${parseVersion}`)
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16)
}

// ── Load / Save ────────────────────────────────────────────────────────

export function emptyCache(): SessionCache {
  return { version: CACHE_VERSION, providers: {}, complete: false }
}

/** A cache is warm only when a full scan finished against it. Empty-but-marked
 *  (a machine with no sessions) is complete; present-but-unmarked (an interrupted
 *  cold start, or a pre-marker cache) is NOT — it is still cold. */
export function isCacheComplete(cache: SessionCache): boolean {
  return cache.complete === true
}

export function isValidCache(raw: unknown): raw is SessionCache {
  return validateSessionCache(raw, CACHE_VERSION)
}

export { validateCachedFile }

// Every prior versioned cache file that can still exist on disk from a shipped or
// dev build, NEWEST first. On a bump we adopt the newest one present: its
// expired-source PR orphans (transcripts since deleted) hold attributable spend
// that can never be re-parsed, and each newer version already carried the older
// versions' orphans forward, so the newest is a superset. INVARIANT: a
// CACHE_VERSION bump MUST extend this list to every prior version that can still
// exist on disk, or that history silently vanishes. (v5 was missed on the 5->6
// bump; v6 on the 6->7 bump; both are listed here.)
const PRIOR_CACHE_VERSIONS = [7, 6, 5] as const

function priorCacheFile(version: number): string {
  return `session-cache.v${version}.json`
}

// Lightweight top-level check: a specific prior-version cache envelope with a
// providers object. Files are validated per-entry in adoptPriorCache so one
// corrupt entry cannot drop every valid expired-transcript PR session.
function isCacheEnvelope(raw: unknown, version: number): raw is { version: number; providers: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return o['version'] === version
    && !!o['providers'] && typeof o['providers'] === 'object' && !Array.isArray(o['providers'])
}

// One-time migration on a version bump: carry forward exactly the prior-version
// entries whose source no longer exists AND that carry prLinks (they can never
// re-parse, but they hold attributable PR spend); present sources are dropped so
// they re-parse fresh under the new version and gain the new fields. Each file is
// validated individually, so a single corrupt entry is skipped rather than
// discarding the whole cache. Each carried section takes the CURRENT
// envFingerprint so the scan reuses it and appends the freshly-parsed present
// sources. The daily cache (durable cost history) is not touched.
async function adoptPriorCache(version: number): Promise<SessionCache | null> {
  try {
    const raw = await readFile(join(getCacheDir(), priorCacheFile(version)), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!isCacheEnvelope(parsed, version)) return null
    const migrated: SessionCache = { version: CACHE_VERSION, providers: {}, complete: false }
    for (const [provider, section] of Object.entries(parsed.providers)) {
      if (!section || typeof section !== 'object') continue
      const rawFiles = (section as Record<string, unknown>)['files']
      const files: Record<string, CachedFile> = {}
      if (rawFiles && typeof rawFiles === 'object' && !Array.isArray(rawFiles)) {
        for (const [path, file] of Object.entries(rawFiles as Record<string, unknown>)) {
          if (!validateCachedFile(file)) continue
          const durable = (section as Record<string, unknown>)['durable'] === true || DURABLE_PROVIDER_NAMES.has(provider)
          if (!existsSync(path) && (file.prLinks?.length || durable)) files[path] = file
        }
      }
      migrated.providers[provider] = {
        envFingerprint: computeEnvFingerprint(provider),
        files,
        ...((section as Record<string, unknown>)['durable'] || DURABLE_PROVIDER_NAMES.has(provider) ? { durable: true } : {}),
      }
    }
    return migrated
  } catch {
    return null
  }
}

// Adopt EVERY prior versioned cache present on disk, migrating OLDEST first and
// merging per source path so a newer version wins per entry. Returning the newest
// alone would be wrong: a sparse or partial newer file (e.g. v6 holding only some
// orphans) would mask older-only orphans that still hold attributable spend. Newer
// entries overwrite older ones for the same path; entries unique to an older
// version survive.
async function adoptNewestPriorCache(): Promise<SessionCache | null> {
  const oldestFirst = [...PRIOR_CACHE_VERSIONS].sort((a, b) => a - b)
  let merged: SessionCache | null = null
  for (const version of oldestFirst) {
    const adopted = await adoptPriorCache(version)
    if (!adopted) continue
    if (!merged) { merged = adopted; continue }
    for (const [provider, section] of Object.entries(adopted.providers)) {
      const existing = merged.providers[provider]
      if (!existing) { merged.providers[provider] = section; continue }
      // Newer version's entries overwrite older ones for the same source path.
      Object.assign(existing.files, section.files)
      if (section.durable) existing.durable = true
    }
  }
  return merged
}

export async function loadCache(): Promise<SessionCache> {
  try {
    const raw = await readFile(getCachePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (isValidCache(parsed)) { rememberSessionCachePayloadEvidenceV1(parsed, raw); return parsed }
  } catch { /* fall through to safe adoption */ }
  return afterMissingVersionedCache()
}

// The current versioned file is absent/unreadable. Prefer adopting the newest
// prior versioned file's expired-source PR/durable orphans (v7 before v6/v5); failing that,
// fall back to the legacy unversioned file. Either way the versioned file is
// minted on the next save.
async function afterMissingVersionedCache(): Promise<SessionCache> {
  const prior = await adoptNewestPriorCache()
  if (prior) return prior
  // isValidCache requires version === CACHE_VERSION, so a different-version
  // legacy file is ignored (left intact). We copy it into the versioned file once
  // via saveCache; the legacy file is never modified.
  return adoptLegacyCache()
}

async function adoptLegacyCache(): Promise<SessionCache> {
  try {
    const raw = await readFile(getLegacyCachePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!isValidCache(parsed)) return emptyCache()
    // Doctor may load a legacy cache only to report provider health. Preserve
    // the read-only contract by returning the validated payload without minting
    // the current versioned file during that diagnostic pass.
    if (process.env['METRORA_SUPPRESS_CACHE_WRITES']) return parsed
    await saveCache(parsed).catch(() => {})
    return parsed
  } catch {
    return emptyCache()
  }
}

export async function saveCache(cache: SessionCache, verifyStillOwner?: () => Promise<boolean>): Promise<boolean> {
  const dir = getCacheDir()
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const finalPath = getCachePath()
  const tempPath = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`
  delete (cache as { _dirty?: boolean })._dirty
  const payload = JSON.stringify(cache)
  const handle = await open(tempPath, 'w', 0o600)
  try {
    await handle.writeFile(payload, { encoding: 'utf-8' })
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    // The warm refresh transaction passes an ownership fence. It must be the
    // final operation before publication so a displaced writer cannot replace
    // the canonical cache with its stale snapshot.
    if (verifyStillOwner && !await verifyStillOwner()) {
      await retryCacheFileMutation(() => unlink(tempPath))
      return false
    }
    let renamed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rename(tempPath, finalPath)
        renamed = true
        break
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if ((code !== 'EPERM' && code !== 'EBUSY') || attempt === 2) throw err
        await new Promise(resolve => { setTimeout(resolve, 10 * (attempt + 1)) })
      }
    }
    if (!renamed) throw new Error('session cache rename failed')
    rememberSessionCachePayloadEvidenceV1(cache, payload); await writeSessionCacheGenerationFromPayloadV1(finalPath, cache, payload).catch(() => {})
    return true
  } catch (err) {
    await retryCacheFileMutation(() => unlink(tempPath))
    throw err
  }
}

async function retryCacheFileMutation(operation: () => Promise<void>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await operation()
      return true
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return true
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt === 2) return false
      await new Promise(resolve => { setTimeout(resolve, 10 * (attempt + 1)) })
    }
  }
  return false
}

// ── File Fingerprinting ────────────────────────────────────────────────
//
// This public authority preserves historical single-file behavior for JSONL
// and other ordinary sources. SQLite paths additionally include their live WAL
// state through the dedicated Metrora-owned helper.

export async function fingerprintFile(filePath: string): Promise<FileFingerprint | null> {
  return fingerprintSourceFile(filePath)
}

// ── Reconciliation ─────────────────────────────────────────────────────

export type ReconcileAction =
  | { action: 'unchanged' }
  | { action: 'appended'; readFromOffset: number }
  | { action: 'modified' }
  | { action: 'new' }

function sqliteWalFingerprintMatches(a: FileFingerprint, b: FileFingerprint): boolean {
  if (a.sqliteWal === undefined || b.sqliteWal === undefined) {
    return a.sqliteWal === b.sqliteWal
  }
  return a.sqliteWal.mtimeMs === b.sqliteWal.mtimeMs
    && a.sqliteWal.sizeBytes === b.sqliteWal.sizeBytes
}

export function reconcileFile(
  current: FileFingerprint,
  cached: CachedFile | undefined,
): ReconcileAction {
  if (!cached) return { action: 'new' }

  const fp = cached.fingerprint

  if (
    fp.dev === current.dev &&
    fp.ino === current.ino &&
    fp.mtimeMs === current.mtimeMs &&
    fp.sizeBytes === current.sizeBytes &&
    sqliteWalFingerprintMatches(fp, current)
  ) {
    return { action: 'unchanged' }
  }

  if (
    cached.lastCompleteLineOffset !== undefined &&
    // SQLite sources are always reparsed as whole databases. The append path is
    // reserved for historical single-file streams such as JSONL.
    fp.sqliteWal === undefined &&
    current.sqliteWal === undefined &&
    // Defensive: never resume past the file's current end. A truncate-then-regrow
    // can leave the cached offset stranded beyond live bytes; reading from there
    // would silently drop the appended tail, so fall back to a full re-parse.
    cached.lastCompleteLineOffset <= current.sizeBytes &&
    fp.dev === current.dev &&
    fp.ino === current.ino &&
    current.sizeBytes > fp.sizeBytes
  ) {
    return { action: 'appended', readFromOffset: cached.lastCompleteLineOffset }
  }

  return { action: 'modified' }
}

// ── Dedup Merge ────────────────────────────────────────────────────────
// When appending incremental data, streaming Claude messages can re-emit
// the same dedup key with updated usage. Merge by key: keep the earliest
// timestamp, take incoming usage/tools/bashCommands/skills (latest wins).

export function mergeCallByDedupKey(
  existing: CachedCall,
  incoming: CachedCall,
): CachedCall {
  return {
    ...incoming,
    timestamp: existing.timestamp < incoming.timestamp
      ? existing.timestamp
      : incoming.timestamp,
  }
}

// ── Temp Cleanup ────────────────────────────────────────────────────────

export async function cleanupOrphanedTempFiles(): Promise<void> {
  const dir = getCacheDir()
  if (!existsSync(dir)) return

  try {
    const entries = await readdir(dir)
    const now = Date.now()

    // Only our own (versioned) temp files. Legacy `session-cache.json.*.tmp`
    // temps belong to old binaries mid-write and must not be touched.
    const prefix = `${CACHE_FILE}.`
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith('.tmp')) continue
      try {
        const fullPath = join(dir, entry)
        const s = await stat(fullPath)
        if (now - s.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
          await unlink(fullPath)
        }
      } catch {}
    }
  } catch {}
}

// ── Hydration Lock ─────────────────────────────────────────────────────
//
// Advisory, cross-process coordination for the expensive cold hydration. When
// two live processes (e.g. an old launchd menubar and the desktop app) both
// cold-start against the same cache dir, without this they each parse full
// history and race their writes. The first to arrive creates the lock and
// hydrates; a second live process waits for release, then reads the now-warm
// cache instead of re-parsing. It is strictly an optimization: on any
// uncertainty we proceed with the parse, so it can never wedge a cold start.

const HYDRATION_LOCK_FILE = 'hydrating.lock'
const LOCK_FRESH_MS = 15 * 60_000
const LOCK_WAIT_MAX_MS = 10 * 60_000
const LOCK_POLL_MS = 250

type LockRecord = { pid: number; at: number }
export type HydrationHandle = { waited: boolean; release: () => Promise<void> }

const NOOP_HANDLE: HydrationHandle = { waited: false, release: async () => {} }

function lockPath(): string {
  return join(getCacheDir(), HYDRATION_LOCK_FILE)
}

// Our own pid never counts as a foreign holder: a same-process lock is either
// re-entrant or leaked, and waiting on ourselves risks a self-hang. Cross-process
// coordination is the only thing this lock is for. EPERM means the pid exists but
// belongs to another user — still alive.
function pidLooksAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  try { process.kill(pid, 0); return true }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM' }
}

async function readLockRecord(): Promise<LockRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath(), 'utf-8')) as Partial<LockRecord>
    if (typeof parsed?.pid === 'number' && typeof parsed?.at === 'number') return { pid: parsed.pid, at: parsed.at }
    return null
  } catch { return null }
}

async function writeOurLock(): Promise<boolean> {
  try {
    const dir = getCacheDir()
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    const handle = await open(lockPath(), 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }), { encoding: 'utf-8' }) }
    finally { await handle.close() }
    return true
  } catch { return false }
}

async function removeOurLock(): Promise<void> {
  try {
    const cur = await readLockRecord()
    if (cur && cur.pid === process.pid) await unlink(lockPath())
  } catch { /* best-effort; a leaked lock is reclaimed as stale next cold start */ }
}

// Synchronous variant for the signal path: a handler can't await, so read + unlink
// synchronously. Only unlinks a lock we actually own.
function removeOurLockSync(): void {
  try {
    const parsed = JSON.parse(readFileSync(lockPath(), 'utf-8')) as Partial<LockRecord>
    if (parsed?.pid === process.pid) unlinkSync(lockPath())
  } catch { /* best-effort; nothing to clean or already gone */ }
}

// Arm once, only while we hold the lock: on a catchable termination (Ctrl-C, or a
// SIGTERM from a parent) clean our lock before dying so a killed cold parse leaves
// no leftover. SIGKILL can't be caught, so that path still relies on the next cold
// start's stale-lock takeover. process.once + re-raise preserves the default exit.
let signalCleanupArmed = false
function armSignalCleanup(): void {
  if (signalCleanupArmed) return
  signalCleanupArmed = true
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      removeOurLockSync()
      process.kill(process.pid, sig)
    })
  }
}

const releaseHandle: HydrationHandle = { waited: false, release: removeOurLock }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Coordinate a cold hydration. Pass `isCold = true` only when the on-disk cache
 * is empty (a genuine full parse is imminent). Returns a handle:
 *  - `waited: true`  → another live process was hydrating; we waited for it to
 *    finish (or timed out). The caller should RELOAD the cache and let its normal
 *    reconcile serve the now-warm entries instead of re-parsing. `release` is a
 *    no-op (we never held the lock).
 *  - `waited: false` with a real `release` → we hold the lock; hydrate, then call
 *    `release()` in a finally.
 *  - `waited: false` with a no-op `release` → proceed with the parse unlocked
 *    (not cold, or the lock state was uncertain).
 */
export async function beginColdHydration(isCold: boolean): Promise<HydrationHandle> {
  if (!isCold) return NOOP_HANDLE
  try {
    if (await writeOurLock()) { armSignalCleanup(); return releaseHandle }
    const existing = await readLockRecord()
    const fresh = existing !== null && Date.now() - existing.at < LOCK_FRESH_MS
    if (existing && fresh && pidLooksAlive(existing.pid)) {
      // Another live process owns a fresh lock: wait for it to release, go stale,
      // or die. A CLEAN release means the cache is warm — reload it. Going stale or
      // dying (e.g. a SIGKILLed cold scan) means the holder left partial data AND a
      // leftover lock file: take over — clean the stale lock and re-acquire — so we
      // re-parse under our own lock and remove the leftover on release, instead of
      // leaving it for the next cold start to reclaim.
      const deadline = Date.now() + LOCK_WAIT_MAX_MS
      let takeover = false
      while (Date.now() < deadline) {
        await sleep(LOCK_POLL_MS)
        const cur = await readLockRecord()
        if (!cur) break
        if (Date.now() - cur.at >= LOCK_FRESH_MS) { takeover = true; break }
        if (!pidLooksAlive(cur.pid)) { takeover = true; break }
      }
      if (takeover) {
        try { await unlink(lockPath()) } catch { /* another process may have; fine */ }
        if (await writeOurLock()) { armSignalCleanup(); return releaseHandle }
      }
      return { waited: true, release: async () => {} }
    }
    // Stale, dead-pid, or unreadable lock: replace it and take over.
    try { await unlink(lockPath()) } catch { /* another process may have; fine */ }
    if (await writeOurLock()) return releaseHandle
    return NOOP_HANDLE
  } catch {
    return NOOP_HANDLE
  }
}
