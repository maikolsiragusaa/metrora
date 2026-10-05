import { join } from 'path'

import { calculateCost, getShortModelName } from '../models.js'
import { billableOutputTokens, type CacheTokenEvidence, type UsageTokenEvidence } from '../token-semantics.js'
import { extractBashCommands } from '../bash-utils.js'
import { normalizeExplicitModelProvider } from '../model-provider.js'
import {
  discoverDshSessionsInDir,
  dshHeaderMatchesPath,
  dshTimestamp,
  getDshHome,
  noticeDshPath,
  projectFromCwd,
  readDshEventLines,
  type DshEvent,
  type DshUsage,
} from './dsh-session-log.js'
import type { ProbeRoot, Provider, SessionSource, SessionParser, ParsedProviderCall } from './types.js'

// Parsing half of the DeepSeek Harness (dsh) collector; the reading half
// (discovery, zstd frame scanning, header probes) is `dsh-session-log.ts`.
//
// A DSH step is "one model call plus the tool executions it requested", and
// every `tool/call` carries the (turn, step) it belongs to, so tools join their
// usage row exactly rather than by timestamp proximity. Observations are
// bucketed per step because a step can be attempted more than once: a
// `llm/retry-started` event opens a new additive attempt, while a settled
// observation replaces an unsettled one in place (no double counting and no
// lost retry).
//
// Ported from the upstream source snapshot's `src/providers/dsh.ts` at commit
// aded4c232622b82284f22d172cecb137354e3071 (MIT; the repository is named in
// THIRD_PARTY_NOTICES.md), extended to Session format version 4.

const PROVIDER_NAME = 'dsh'
const DISPLAY_NAME = 'DeepSeek Harness'

const toolNameMap: Record<string, string> = {
  bash: 'Bash',
  pwsh: 'Bash',
  powershell: 'Bash',
  shell: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  str_replace_editor: 'Edit',
  multi_edit: 'Edit',
  apply_patch: 'Patch',
  glob: 'Glob',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  todo_write: 'TodoWrite',
  todo: 'TodoWrite',
  subagent: 'Agent',
  agent: 'Agent',
  task: 'Agent',
  skill: 'Skill',
  notebook_edit: 'NotebookEdit',
  ask_user_question: 'AskUserQuestion',
}

function mapToolName(raw: string): string {
  return toolNameMap[raw] ?? raw
}

// Usage fields are whatever the JSON held. A string or array would flow
// straight into the global token totals and the persisted cache, where
// `0 + [1, 2]` silently becomes "01,2". Same semantics as copilot.ts.
function numberOrZero(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : 0
}

function usageIsComplete(usage: DshUsage): boolean {
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  return count(usage.inputTokens) && count(usage.outputTokens)
    && [usage.cacheReadTokens, usage.cacheWriteTokens, usage.reasoningTokens].every(value => value === undefined || count(value))
    && (usage.reasoningTokens === undefined || usage.reasoningTokens <= usage.outputTokens)
}

/**
 * How much of DSH's cache accounting the record actually carried. The harness's
 * own arithmetic bills input as `inputTokens + cacheReadTokens +
 * cacheWriteTokens`, so a missing cache field is not the same as a reported
 * zero and must not be flattened into one.
 */
function cacheTokenEvidence(usage: DshUsage): CacheTokenEvidence {
  const count = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const read = count(usage.cacheReadTokens)
  const write = count(usage.cacheWriteTokens)
  if (read && write) return 'complete'
  return read || write ? 'partial' : 'unavailable'
}

/**
 * How much of the record's primary token counters the log actually carried.
 * A reported zero is complete evidence of zero; a missing or non-numeric
 * counter is unknown, not a zero, and must not read as one downstream.
 */
function usageEvidence(usage: DshUsage): UsageTokenEvidence {
  const count = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  if (input && output) return 'complete'
  return input || output ? 'partial' : 'unavailable'
}

type UsageObservation = {
  usage: DshUsage
  time?: number
  model: string
  provider: string
  final: boolean
}

type StepBucket = {
  observations: UsageObservation[]
  tools: string[]
  skills: string[]
  bashCommands: string[]
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

// v2+ settles a step's stream inside its own record: the usage chunk rides in
// `assistant/message.data.stream` (and in `assistant/attempt.data.stream` for an
// attempt that committed no surface message). The message's own `usage` is the
// collapsed authority, so the stream chunk is only a fallback — reading both
// would count the same call twice.
function usageFromStream(stream: NonNullable<DshEvent['data']>['stream']): DshUsage | undefined {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage
  }
  return undefined
}

function emptyStepBucket(): StepBucket {
  return { observations: [], tools: [], skills: [], bashCommands: [] }
}

// DSH's route ids name the account a request was served through, while the
// reviewed price book is keyed by the billing authority. Only routes whose
// authority is verified are declared: an unknown route keeps its descriptive
// provider and no invented price authority, so its cost stays the parse-time
// estimate instead of borrowing another authority's rates.
const PRICING_AUTHORITY_BY_ROUTE: Record<string, string> = {
  'deepseek-account': 'deepseek',
  'deepseek-official': 'deepseek',
  deepseek: 'deepseek',
}

// The model and provider a call was routed through, tracked from the two
// request records DSH writes. `request/header` snapshots the full call config,
// `request/context` the route metadata when it changes; a message that reports
// its own source overrides both.
type RouteState = { model: string; provider: string }

function trackedRoute(state: RouteState, next: { model?: unknown; provider?: unknown }): RouteState {
  let { model, provider } = state
  if (typeof next.model === 'string' && next.model) model = next.model
  if (typeof next.provider === 'string' && next.provider) provider = next.provider
  return { model, provider }
}

function createParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      const lines = await readDshEventLines(source.path)
      if (!lines) return

      const events: DshEvent[] = []
      let corruptInterior = false
      for (const [index, line] of lines.entries()) {
        try {
          const value: unknown = JSON.parse(line)
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            if (index === 0) return
            corruptInterior = true
            continue
          }
          events.push(value as DshEvent)
        } catch {
          if (index === 0) return
          // A torn final append may be discarded. Malformed rows in the middle
          // of a versioned log cannot justify a complete historical total.
          if (index < lines.length - 1) corruptInterior = true
        }
      }

      const header = events[0]
      if (header?.type !== 'session' || !dshHeaderMatchesPath(header, source.path)) return
      const formatVersion = header.version!
      if (formatVersion >= 2 && corruptInterior) {
        noticeDshPath('skipping corrupt DSH session with malformed interior rows', source.path)
        return
      }

      const sessionId = typeof header.id === 'string' ? header.id : ''
      const cwd = typeof header.cwd === 'string' ? header.cwd : ''
      let headerRoute: RouteState = { model: 'unknown', provider: '' }
      let contextRoute: RouteState = { model: '', provider: '' }
      let currentTurn = 0
      const sessionStart = dshTimestamp(header.createdAt, '')
      // Events a forked session inherited from its parent. They are a verbatim
      // copy of the parent's log, which Metrora parses as its own session, so
      // counting them here would bill the same calls twice.
      let inheritedCut = formatVersion <= 1 && typeof header.parentSession === 'string' && header.parentSession
        && typeof header.seedLength === 'number'
        ? header.seedLength - 1
        : -1
      if (formatVersion >= 2) {
        const taggedCuts = events
          .filter(event => event.type === 'session/end-seed' && event.data?.inherited === true && typeof event.seq === 'number')
          .map(event => event.seq!)
        if (header.isSeeded === true && taggedCuts.length === 0) {
          noticeDshPath('skipping corrupt seeded DSH session without an inherited end-seed marker', source.path)
          return
        }
        if (header.isSeeded !== true && taggedCuts.length > 0) {
          noticeDshPath('skipping corrupt unseeded DSH session with an inherited end-seed marker', source.path)
          return
        }
        inheritedCut = taggedCuts.at(-1) ?? -1
      }
      const userMessageByTurn = new Map<number, string>()
      const buckets = new Map<string, StepBucket>()
      const activeAttempts = new Map<string, number>()
      let sawIncompleteUsage = false

      for (const event of events) {
        if (event.type === 'session') continue

        // Inherited request state can remain authoritative for the child's
        // first local attempt even though inherited usage is not billable.
        if (event.type === 'request/header') {
          const config = event.data?.header?.config
          const next = trackedRoute(headerRoute, { model: config?.model, provider: config?.provider })
          // A new model invalidates the lighter route note that preceded it.
          if (next.model !== headerRoute.model) contextRoute = { ...contextRoute, model: '' }
          if (next.provider !== headerRoute.provider) contextRoute = { ...contextRoute, provider: '' }
          headerRoute = next
          continue
        }

        if (event.type === 'request/context') {
          contextRoute = trackedRoute(contextRoute, { model: event.data?.model, provider: event.data?.provider })
          continue
        }

        if (typeof event.seq === 'number' && event.seq <= inheritedCut) continue

        if (event.type === 'turn/start') {
          currentTurn = event.data?.turn ?? currentTurn
          continue
        }

        if (event.type === 'llm/retry-started') {
          const turn = event.data?.turn ?? currentTurn
          const step = event.data?.step ?? 0
          activeAttempts.delete(`${turn}:${step}`)
          continue
        }

        if (event.type === 'user/message') {
          // Plugin-injected context (runtime snapshots, skill bodies, file-change
          // notices) rides the same event type as a typed prompt; only the latter
          // is a useful preview.
          if (event.data?.source?.kind !== 'user') continue
          if (userMessageByTurn.has(currentTurn)) continue
          const content = event.data?.content
          const texts = (Array.isArray(content) ? content : [])
            .filter(c => c?.type === 'text' && typeof c.text === 'string' && c.text)
            .map(c => c.text!)
          if (texts.length > 0) userMessageByTurn.set(currentTurn, texts.join(' ').slice(0, 500))
          continue
        }

        if (event.type === 'tool/call') {
          const turn = event.data?.turn ?? currentTurn
          const step = event.data?.step ?? 0
          const rawName = event.data?.name
          if (typeof rawName !== 'string' || !rawName) continue
          const key = `${turn}:${step}`
          let bucket = buckets.get(key)
          if (!bucket) {
            bucket = emptyStepBucket()
            buckets.set(key, bucket)
          }
          bucket.tools.push(mapToolName(rawName))
          const args = parseToolArguments(event.data?.arguments)
          if ((rawName === 'bash' || rawName === 'pwsh') && typeof args?.['command'] === 'string') {
            bucket.bashCommands.push(...extractBashCommands(args['command']))
          }
          if (rawName === 'skill' && typeof args?.['name'] === 'string') {
            bucket.skills.push(args['name'])
          }
          continue
        }

        let usage: DshUsage | undefined
        let isFinal = false
        // A usage-bearing event Metrora expected accounting from. An
        // `assistant/attempt` is excluded: an attempt that committed no surface
        // message usually made no billable call at all, so its silence is not
        // missing evidence.
        let accountingExpected = false
        let reportedRoute = contextRoute.model || contextRoute.provider
          ? { model: contextRoute.model || headerRoute.model, provider: contextRoute.provider || headerRoute.provider }
          : headerRoute
        if (formatVersion <= 1 && event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
          usage = event.data.chunk.usage
          accountingExpected = true
        } else if (event.type === 'assistant/message') {
          usage = event.data?.usage ?? (formatVersion >= 2 ? usageFromStream(event.data?.stream) : undefined)
          isFinal = true
          accountingExpected = true
          const messageSource = event.data?.message?.source
          reportedRoute = trackedRoute(reportedRoute, { model: messageSource?.model, provider: messageSource?.provider })
        } else if (formatVersion >= 2 && event.type === 'assistant/attempt') {
          usage = usageFromStream(event.data?.stream)
          isFinal = true
        } else {
          continue
        }
        const turn = event.data?.turn ?? currentTurn
        const step = event.data?.step ?? 0
        if (![turn, step].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
          noticeDshPath('skipping DSH usage with invalid attempt coordinates', source.path)
          continue
        }
        const key = `${turn}:${step}`
        if (!usage) {
          if (accountingExpected && !activeAttempts.has(key)) {
            noticeDshPath('DSH session contains a committed call without usage; totals may be incomplete', source.path)
          }
          continue
        }
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = emptyStepBucket()
          buckets.set(key, bucket)
        }
        const observation = {
          usage,
          time: event.time,
          model: reportedRoute.model,
          provider: reportedRoute.provider,
          final: isFinal,
        }
        // A different step cannot close this step's replacement slot. Only
        // its own retry-started event makes the next observation additive.
        const activeIndex = activeAttempts.get(key)
        if (activeIndex !== undefined) {
          if (!bucket.observations[activeIndex]?.final || isFinal) {
            bucket.observations[activeIndex] = observation
          }
        } else {
          bucket.observations.push(observation)
          activeAttempts.set(key, bucket.observations.length - 1)
        }
      }

      const sortedKeys = [...buckets.keys()].sort((a, b) => {
        const [ta, sa] = a.split(':').map(Number)
        const [tb, sb] = b.split(':').map(Number)
        return ta! - tb! || sa! - sb!
      })

      for (const key of sortedKeys) {
        const bucket = buckets.get(key)!
        for (let attempt = 0; attempt < bucket.observations.length; attempt += 1) {
          const observation = bucket.observations[attempt]!
          const input = numberOrZero(observation.usage.inputTokens)
          const output = numberOrZero(observation.usage.outputTokens)
          const cacheRead = numberOrZero(observation.usage.cacheReadTokens)
          const cacheWrite = numberOrZero(observation.usage.cacheWriteTokens)
          const reasoning = Math.min(numberOrZero(observation.usage.reasoningTokens), output)
          if (!usageIsComplete(observation.usage) && !sawIncompleteUsage) {
            sawIncompleteUsage = true
            noticeDshPath('DSH session contains incomplete or invalid usage; retained counts are estimated', source.path)
          }
          if (input + output + cacheRead + cacheWrite === 0) continue

          const attemptKey = attempt === 0 ? key : `${key}:attempt:${attempt + 1}`
          const dedupKey = `${PROVIDER_NAME}:${sessionId || source.path}:${attemptKey}`
          if (seenKeys.has(dedupKey)) continue
          seenKeys.add(dedupKey)

          // DSH TokenUsage defines reasoning as informational detail already
          // included in outputTokens, so the ledger declares that semantics
          // explicitly: output is billed as reported, and the reasoning count
          // rides along for the breakdown without being added a second time.
          const model = observation.model || 'unknown'
          const modelProvider = normalizeExplicitModelProvider(observation.provider)
          const pricingAuthority = modelProvider ? PRICING_AUTHORITY_BY_ROUTE[modelProvider] : undefined
          const costUSD = calculateCost(
            model,
            input,
            billableOutputTokens(PROVIDER_NAME, output, reasoning, 'aggregate-output'),
            cacheWrite,
            cacheRead,
            0,
          )
          const [turn] = key.split(':').map(Number)

          yield {
            provider: PROVIDER_NAME,
            model,
            ...(modelProvider ? { modelProvider } : {}),
            ...(pricingAuthority ? { pricingContext: { pricingAuthority } } : {}),
            inputTokens: input,
            outputTokens: output,
            cacheCreationInputTokens: cacheWrite,
            cacheReadInputTokens: cacheRead,
            cachedInputTokens: cacheRead,
            reasoningTokens: reasoning,
            reasoningSemantics: 'aggregate-output' as const,
            cacheTokenEvidence: cacheTokenEvidence(observation.usage),
            usageEvidence: usageEvidence(observation.usage),
            webSearchRequests: 0,
            costUSD,
            // DSH reports no cost of its own, so this cost is always derived
            // from the reviewed rate books rather than measured at the source.
            costIsEstimated: true,
            tools: attempt === bucket.observations.length - 1 ? [...new Set(bucket.tools)] : [],
            bashCommands: attempt === bucket.observations.length - 1 ? bucket.bashCommands : [],
            skills: attempt === bucket.observations.length - 1 && bucket.skills.length > 0 ? [...new Set(bucket.skills)] : undefined,
            timestamp: dshTimestamp(observation.time, sessionStart),
            speed: 'standard',
            deduplicationKey: dedupKey,
            userMessage: userMessageByTurn.get(turn!) ?? '',
            sessionId: sessionId || source.path,
            project: cwd ? projectFromCwd(cwd, source.project) : source.project,
            projectPath: cwd || undefined,
            workingDirectory: cwd || undefined,
          }
        }
      }
    },
  }
}

export function createDshProvider(dshHomeOverride?: string): Provider {
  const dshHome = getDshHome(dshHomeOverride)
  const sessionsDir = join(dshHome, 'sessions')

  return {
    name: PROVIDER_NAME,
    displayName: DISPLAY_NAME,

    modelDisplayName(model: string): string {
      return getShortModelName(model)
    },

    toolDisplayName(rawTool: string): string {
      return mapToolName(rawTool)
    },

    async probeRoots(): Promise<ProbeRoot[]> {
      return [{ path: sessionsDir, label: 'DSH sessions' }]
    },

    async discoverSessions(): Promise<SessionSource[]> {
      return discoverDshSessionsInDir(sessionsDir)
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      return createParser(source, seenKeys)
    },
  }
}

export const dsh = createDshProvider()
