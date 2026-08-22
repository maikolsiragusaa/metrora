import type { CategoryDayStats, DailyEntry, ModelDayStats, ProjectDayStats, ProviderDaySlice } from './daily-cache.js'
import type { PeriodData } from './menubar-json.js'
import { CATEGORY_LABELS, type ProjectSummary, type TaskCategory, type TokenUsage } from './types.js'
import { combineReasoningSemantics, reasoningTokenTotals, type ReasoningTokenSemantics, type ReasoningTokenTotals } from './token-semantics.js'
import { emptyModelStats, mergeModelStats } from './daily-cache-model-detail.js'
import { emptyCategoryStats, mergeCategoryStats, setOwn } from './daily-cache-category-detail.js'
import { addCategoryDetail, addModelDetail } from './daily-cache-project-detail.js'

// Raw model IDs remain human-readable in legacy daily caches. New rows use an
// additive envelope so a source-recorded route can survive the daily
// projection without changing the model ID used for pricing.
const MODEL_KEY_PREFIX = '\u0001metrora-model\u0001'
export function modelStorageKey(model: string, modelProvider?: string): string {
  return modelProvider ? `${MODEL_KEY_PREFIX}${JSON.stringify([modelProvider, model])}` : model
}

function decodeModelStorageKey(key: string): { name: string; modelProvider?: string } {
  if (!key.startsWith(MODEL_KEY_PREFIX)) return { name: key }
  try {
    const value = JSON.parse(key.slice(MODEL_KEY_PREFIX.length)) as unknown
    if (Array.isArray(value) && typeof value[1] === 'string') {
      return {
        name: value[1],
        ...(typeof value[0] === 'string' && value[0].length > 0 ? { modelProvider: value[0] } : {}),
      }
    }
  } catch {
    // A malformed foreign key stays visible as its raw key rather than being
    // dropped from durable accounting.
  }
  return { name: key }
}

function addCallReasoningSemantics(
  target: { reasoningSemantics?: ReasoningTokenSemantics },
  call: { reasoningSemantics?: ReasoningTokenSemantics },
): void {
  if (call.reasoningSemantics === undefined) return
  target.reasoningSemantics = target.reasoningSemantics === undefined
    ? call.reasoningSemantics
    : combineReasoningSemantics([target.reasoningSemantics, call.reasoningSemantics])
}

function callReasoningTotals(call: { provider: string; usage: TokenUsage; reasoningSemantics?: ReasoningTokenSemantics }): ReasoningTokenTotals {
  return reasoningTokenTotals(call.usage.reasoningTokens, call.reasoningSemantics)
}

function addReasoningTotals(target: { reasoningTokens?: number; additiveReasoningTokens?: number }, totals: ReasoningTokenTotals): void {
  if (totals.observedReasoningTokens > 0) {
    target.reasoningTokens = (target.reasoningTokens ?? 0) + totals.observedReasoningTokens
    // Keep an explicit zero for aggregate-output evidence so a durable row
    // cannot later be mistaken for a legacy row with no additive authority.
    target.additiveReasoningTokens = (target.additiveReasoningTokens ?? 0) + totals.additiveReasoningTokens
  }
}

function addProjectTokenUsage(target: ProjectDayStats, usage: TokenUsage, reasoning: ReasoningTokenTotals): void {
  target.inputTokens = (target.inputTokens ?? 0) + usage.inputTokens
  target.outputTokens = (target.outputTokens ?? 0) + usage.outputTokens
  target.cacheReadTokens = (target.cacheReadTokens ?? 0) + usage.cacheReadInputTokens
  target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + usage.cacheCreationInputTokens
  addReasoningTotals(target, reasoning)
}

function modelStatsForCall(call: {
  provider: string
  modelProvider?: string
  model: string
  costUSD: number
  savingsUSD?: number
  usage: TokenUsage
  reasoningSemantics?: ReasoningTokenSemantics
}, reasoning: ReasoningTokenTotals): ModelDayStats {
  const stats: ModelDayStats = {
    calls: 1,
    cost: call.costUSD,
    savingsUSD: call.savingsUSD ?? 0,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    cacheReadTokens: call.usage.cacheReadInputTokens,
    cacheWriteTokens: call.usage.cacheCreationInputTokens,
    ...(call.modelProvider ? { modelProvider: call.modelProvider } : {}),
    sourceProviders: [call.provider],
  }
  addReasoningTotals(stats, reasoning)
  addCallReasoningSemantics(stats, call)
  return stats
}

function emptyEntry(date: string): DailyEntry {
  return {
    date,
    cost: 0,
    savingsUSD: 0,
    calls: 0,
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers: {},
  }
}

export function dateKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Bucket an ISO timestamp under an explicit IANA timezone. */
export function dateKeyInTz(iso: string, tz: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return dateKey(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  let year = ''
  let month = ''
  let day = ''
  for (const part of parts) {
    if (part.type === 'year') year = part.value
    else if (part.type === 'month') month = part.value
    else if (part.type === 'day') day = part.value
  }
  return year && month && day ? `${year}-${month}-${day}` : dateKey(iso)
}

function emptySlice(): ProviderDaySlice {
  return {
    calls: 0, cost: 0, savingsUSD: 0,
    sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    editTurns: 0, oneShotTurns: 0, models: {}, categories: {},
  }
}

export function aggregateProjectsIntoDays(
  projects: ProjectSummary[],
  dateKeyFn: (iso: string) => string = dateKey,
): DailyEntry[] {
  const byDate = new Map<string, DailyEntry>()
  const ensure = (date: string): DailyEntry => {
    let d = byDate.get(date)
    if (!d) { d = emptyEntry(date); byDate.set(date, d) }
    return d
  }
  const ensureSlice = (day: DailyEntry, provider: string): ProviderDaySlice => {
    let s = Object.hasOwn(day.providers, provider) ? day.providers[provider] : undefined
    if (!s) { s = emptySlice(); setOwn(day.providers, provider, s) }
    return s
  }
  const ensureProject = (holder: { projects?: Record<string, ProjectDayStats> }, project: string, path?: string): ProjectDayStats => {
    const projects = (holder.projects ??= {})
    // defineProperty so a project directory named "__proto__" becomes an own
    // key instead of mutating the prototype link.
    let p = Object.hasOwn(projects, project) ? projects[project] : undefined
    if (!p) {
      p = { cost: 0, calls: 0, savingsUSD: 0, sessions: 0 }
      Object.defineProperty(projects, project, { value: p, enumerable: true, writable: true, configurable: true })
    }
    if (!p.path && path) p.path = path
    return p
  }

  for (const project of projects) {
    for (const session of project.sessions) {
      const sessionDate = dateKeyFn(session.firstTimestamp)
      const sessionDay = ensure(sessionDate)
      sessionDay.sessions += 1
      ensureProject(sessionDay, session.project, project.projectPath).sessions += 1
      // A session belongs to exactly one provider; its calls all carry it.
      const sessionProvider = session.turns.flatMap(t => t.assistantCalls)[0]?.provider
      if (sessionProvider) {
        const slice = ensureSlice(sessionDay, sessionProvider)
        slice.sessions! += 1
        ensureProject(slice, session.project, project.projectPath).sessions += 1
      }

      for (const turn of session.turns) {
        if (turn.assistantCalls.length === 0) continue
        // Turn-anchored bucketing: attribute the WHOLE turn — every one of its
        // calls — to the day of the turn's user-message timestamp, matching the
        // live headline/report rollup (main.ts daily). Falls back to the first
        // assistant-call timestamp when the user line is missing (continuation
        // sessions that begin mid-conversation). Previously the calls were
        // bucketed per-call by each call's own timestamp, so a midnight-
        // straddling turn split across two days and history.daily / the provider
        // breakdown never reconciled to current.cost (a constant offset).
        const turnDate = dateKeyFn(turn.timestamp || turn.assistantCalls[0]!.timestamp)
        const turnDay = ensure(turnDate)

        const editTurns = turn.hasEdits ? 1 : 0
        const oneShotTurns = turn.hasEdits && turn.retries === 0 ? 1 : 0
        const turnCost = turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0)
        const turnSavings = turn.assistantCalls.reduce((s, c) => s + (c.savingsUSD ?? 0), 0)

        turnDay.editTurns += editTurns
        turnDay.oneShotTurns += oneShotTurns

        const categoryContribution: CategoryDayStats = {
          turns: 1,
          cost: turnCost,
          savingsUSD: turnSavings,
          editTurns,
          oneShotTurns,
        }
        const cat = Object.hasOwn(turnDay.categories, turn.category)
          ? turnDay.categories[turn.category]!
          : emptyCategoryStats()
        mergeCategoryStats(cat, categoryContribution)
        setOwn(turnDay.categories, turn.category, cat)

        const dayProject = ensureProject(turnDay, session.project, project.projectPath)
        addCategoryDetail(dayProject, turn.category, categoryContribution)

        // Cost stays attributed to every provider actually present in the turn,
        // but turn counts belong to exactly one slice. Otherwise carrying one
        // missing provider later re-adds a turn already present in the fresh
        // provider's slice. Highest call count wins; when the first call's
        // provider is tied for highest, replacing only on a strict increase
        // leaves that provider selected.
        const providersInTurn = new Map<string, { calls: number; cost: number; savingsUSD: number }>()
        for (const call of turn.assistantCalls) {
          const acc = providersInTurn.get(call.provider) ?? { calls: 0, cost: 0, savingsUSD: 0 }
          acc.calls += 1
          acc.cost += call.costUSD
          acc.savingsUSD += call.savingsUSD ?? 0
          providersInTurn.set(call.provider, acc)
        }
        let primaryProvider = turn.assistantCalls[0]!.provider
        let primaryCalls = providersInTurn.get(primaryProvider)!.calls
        for (const [provider, totals] of providersInTurn) {
          if (totals.calls > primaryCalls) {
            primaryProvider = provider
            primaryCalls = totals.calls
          }
        }
        for (const [prov, totals] of providersInTurn) {
          const turnSlice = ensureSlice(turnDay, prov)
          const ownsTurn = prov === primaryProvider
          turnSlice.editTurns! += ownsTurn ? editTurns : 0
          turnSlice.oneShotTurns! += ownsTurn ? oneShotTurns : 0
          const sliceCategoryContribution: CategoryDayStats = {
            turns: ownsTurn ? 1 : 0,
            cost: totals.cost,
            savingsUSD: totals.savingsUSD,
            editTurns: ownsTurn ? editTurns : 0,
            oneShotTurns: ownsTurn ? oneShotTurns : 0,
          }
          const sliceCat = Object.hasOwn(turnSlice.categories!, turn.category)
            ? turnSlice.categories![turn.category]!
            : emptyCategoryStats()
          mergeCategoryStats(sliceCat, sliceCategoryContribution)
          setOwn(turnSlice.categories!, turn.category, sliceCat)

          const sliceProject = ensureProject(turnSlice, session.project, project.projectPath)
          addCategoryDetail(sliceProject, turn.category, sliceCategoryContribution)
        }

        for (const call of turn.assistantCalls) {
          const callSavings = call.savingsUSD ?? 0
          const callReasoning = callReasoningTotals(call)
          const modelContribution = modelStatsForCall(call, callReasoning)

          turnDay.cost += call.costUSD
          turnDay.savingsUSD += callSavings
          turnDay.calls += 1
          turnDay.inputTokens += call.usage.inputTokens
          turnDay.outputTokens += call.usage.outputTokens
          addReasoningTotals(turnDay, callReasoning)
          turnDay.cacheReadTokens += call.usage.cacheReadInputTokens
          turnDay.cacheWriteTokens += call.usage.cacheCreationInputTokens

          dayProject.cost += call.costUSD
          dayProject.calls += 1
          dayProject.savingsUSD += callSavings
          addProjectTokenUsage(dayProject, call.usage, callReasoning)

          const modelKey = modelStorageKey(call.model, call.modelProvider)
          const model = Object.hasOwn(turnDay.models, modelKey) ? turnDay.models[modelKey]! : emptyModelStats()
          mergeModelStats(model, modelContribution)
          setOwn(turnDay.models, modelKey, model)
          addModelDetail(dayProject, modelKey, modelContribution)

          const slice = ensureSlice(turnDay, call.provider)
          slice.calls += 1
          slice.cost += call.costUSD
          slice.savingsUSD += callSavings
          slice.inputTokens! += call.usage.inputTokens
          slice.outputTokens! += call.usage.outputTokens
          addReasoningTotals(slice, callReasoning)
          slice.cacheReadTokens! += call.usage.cacheReadInputTokens
          slice.cacheWriteTokens! += call.usage.cacheCreationInputTokens

          const sliceProject = ensureProject(slice, session.project, project.projectPath)
          sliceProject.cost += call.costUSD
          sliceProject.calls += 1
          sliceProject.savingsUSD += callSavings
          addProjectTokenUsage(sliceProject, call.usage, callReasoning)

          const sliceModel = Object.hasOwn(slice.models!, modelKey) ? slice.models![modelKey]! : emptyModelStats()
          mergeModelStats(sliceModel, modelContribution)
          setOwn(slice.models!, modelKey, sliceModel)
          addModelDetail(sliceProject, modelKey, modelContribution)
        }
      }
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function buildPeriodDataFromDays(days: DailyEntry[], label: string): PeriodData {
  let cost = 0, savingsUSD = 0, calls = 0, sessions = 0
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0
  let reasoningTokens = 0, additiveReasoningTokens = 0
  let hasReasoningTokens = false
  let hasAdditiveReasoningTokens = false
  const catTotals: Record<string, { turns: number; cost: number; savingsUSD: number; editTurns: number; oneShotTurns: number }> = {}
  const modelTotals: Record<string, {
    calls: number
    cost: number
    savingsUSD: number
    inputTokens: number
    outputTokens: number
    reasoningTokens?: number
    additiveReasoningTokens?: number
    cacheReadTokens: number
    cacheWriteTokens: number
    modelProvider?: string
    sourceProviders?: string[]
    reasoningSemantics?: ReasoningTokenSemantics
  }> = {}

  for (const d of days) {
    cost += d.cost
    savingsUSD += d.savingsUSD
    calls += d.calls
    sessions += d.sessions
    inputTokens += d.inputTokens
    outputTokens += d.outputTokens
    if (d.reasoningTokens !== undefined) {
      reasoningTokens += d.reasoningTokens
      hasReasoningTokens = true
    }
    if (d.additiveReasoningTokens !== undefined) {
      additiveReasoningTokens += d.additiveReasoningTokens
      hasAdditiveReasoningTokens = true
    }
    cacheReadTokens += d.cacheReadTokens
    cacheWriteTokens += d.cacheWriteTokens

    for (const [name, m] of Object.entries(d.models)) {
      const acc = modelTotals[name] ?? {
        calls: 0,
        cost: 0,
        savingsUSD: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }
      acc.calls += m.calls
      acc.cost += m.cost
      acc.savingsUSD += (m.savingsUSD ?? 0)
      acc.inputTokens += m.inputTokens
      acc.outputTokens += m.outputTokens
      if (m.reasoningTokens !== undefined) acc.reasoningTokens = (acc.reasoningTokens ?? 0) + m.reasoningTokens
      if (m.additiveReasoningTokens !== undefined) acc.additiveReasoningTokens = (acc.additiveReasoningTokens ?? 0) + m.additiveReasoningTokens
      if (m.reasoningSemantics) {
        acc.reasoningSemantics = acc.reasoningSemantics === undefined
          ? m.reasoningSemantics
          : combineReasoningSemantics([acc.reasoningSemantics, m.reasoningSemantics])
      }
      acc.cacheReadTokens += m.cacheReadTokens
      acc.cacheWriteTokens += m.cacheWriteTokens
      if (m.modelProvider) acc.modelProvider = m.modelProvider
      if (m.sourceProviders && m.sourceProviders.length > 0) {
        acc.sourceProviders = [...new Set([...(acc.sourceProviders ?? []), ...m.sourceProviders])].sort()
      }
      modelTotals[name] = acc
    }
    for (const [cat, c] of Object.entries(d.categories)) {
      const acc = catTotals[cat] ?? { turns: 0, cost: 0, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 }
      acc.turns += c.turns
      acc.cost += c.cost
      acc.savingsUSD += (c.savingsUSD ?? 0)
      acc.editTurns += c.editTurns
      acc.oneShotTurns += c.oneShotTurns
      catTotals[cat] = acc
    }
  }

  return {
    label,
    cost,
    savingsUSD,
    calls,
    sessions,
    inputTokens,
    outputTokens,
    ...(hasReasoningTokens ? { reasoningTokens } : {}),
    ...(hasAdditiveReasoningTokens ? { additiveReasoningTokens } : {}),
    cacheReadTokens,
    cacheWriteTokens,
    categories: Object.entries(catTotals)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([cat, d]) => ({ name: CATEGORY_LABELS[cat as TaskCategory] ?? cat, ...d })),
    models: Object.entries(modelTotals)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([storageKey, d]) => {
        const identity = decodeModelStorageKey(storageKey)
        return {
          name: identity.name,
          ...(identity.modelProvider || d.modelProvider
            ? { modelProvider: identity.modelProvider ?? d.modelProvider }
            : {}),
          ...(d.sourceProviders && d.sourceProviders.length > 0 ? { sourceProviders: d.sourceProviders } : {}),
          calls: d.calls,
          cost: d.cost,
          savingsUSD: d.savingsUSD,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          ...(d.reasoningSemantics ? { reasoningSemantics: d.reasoningSemantics } : {}),
          ...(d.reasoningTokens !== undefined ? { reasoningTokens: d.reasoningTokens } : {}),
          ...(d.additiveReasoningTokens !== undefined ? { additiveReasoningTokens: d.additiveReasoningTokens } : {}),
          cacheReadTokens: d.cacheReadTokens,
          cacheWriteTokens: d.cacheWriteTokens,
        }
      }),
  }
}
