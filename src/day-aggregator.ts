import type { DailyEntry, ProjectDayStats, ProviderDaySlice } from './daily-cache.js'
import type { PeriodData } from './menubar-json.js'
import { CATEGORY_LABELS, type ProjectSummary, type TaskCategory } from './types.js'

// Raw model IDs remain human-readable in legacy daily caches. New rows use an
// additive envelope so a source-recorded route can survive the daily
// projection without changing the model ID used for pricing.
const MODEL_KEY_PREFIX = '\u0001metrora-model\u0001'
function modelStorageKey(model: string, modelProvider?: string): string {
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

function addSourceProvider(target: { sourceProviders?: string[] }, provider: string): void {
  target.sourceProviders = [...new Set([...(target.sourceProviders ?? []), provider])].sort()
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
    let s = day.providers[provider]
    if (!s) { s = emptySlice(); day.providers[provider] = s }
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

        const cat = turnDay.categories[turn.category] ?? { turns: 0, cost: 0, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 }
        cat.turns += 1
        cat.cost += turnCost
        cat.savingsUSD += turnSavings
        cat.editTurns += editTurns
        cat.oneShotTurns += oneShotTurns
        turnDay.categories[turn.category] = cat

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
          const sliceCat = turnSlice.categories![turn.category] ?? { turns: 0, cost: 0, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 }
          sliceCat.turns += ownsTurn ? 1 : 0
          sliceCat.cost += totals.cost
          sliceCat.savingsUSD += totals.savingsUSD
          sliceCat.editTurns += ownsTurn ? editTurns : 0
          sliceCat.oneShotTurns += ownsTurn ? oneShotTurns : 0
          turnSlice.categories![turn.category] = sliceCat
        }

        for (const call of turn.assistantCalls) {
          const callSavings = call.savingsUSD ?? 0

          turnDay.cost += call.costUSD
          turnDay.savingsUSD += callSavings
          turnDay.calls += 1
          turnDay.inputTokens += call.usage.inputTokens
          turnDay.outputTokens += call.usage.outputTokens
          if (call.usage.reasoningTokens > 0) turnDay.reasoningTokens = (turnDay.reasoningTokens ?? 0) + call.usage.reasoningTokens
          turnDay.cacheReadTokens += call.usage.cacheReadInputTokens
          turnDay.cacheWriteTokens += call.usage.cacheCreationInputTokens

          const dayProject = ensureProject(turnDay, session.project, project.projectPath)
          dayProject.cost += call.costUSD
          dayProject.calls += 1
          dayProject.savingsUSD += callSavings

          const modelKey = modelStorageKey(call.model, call.modelProvider)
          const model = turnDay.models[modelKey] ?? {
            calls: 0, cost: 0, savingsUSD: 0,
            inputTokens: 0, outputTokens: 0,
            cacheReadTokens: 0, cacheWriteTokens: 0,
          }
          model.calls += 1
          model.cost += call.costUSD
          model.savingsUSD += callSavings
          model.inputTokens += call.usage.inputTokens
          model.outputTokens += call.usage.outputTokens
          if (call.usage.reasoningTokens > 0) model.reasoningTokens = (model.reasoningTokens ?? 0) + call.usage.reasoningTokens
          model.cacheReadTokens += call.usage.cacheReadInputTokens
          model.cacheWriteTokens += call.usage.cacheCreationInputTokens
          if (call.modelProvider) model.modelProvider = call.modelProvider
          addSourceProvider(model, call.provider)
          turnDay.models[modelKey] = model

          const slice = ensureSlice(turnDay, call.provider)
          slice.calls += 1
          slice.cost += call.costUSD
          slice.savingsUSD += callSavings
          slice.inputTokens! += call.usage.inputTokens
          slice.outputTokens! += call.usage.outputTokens
          if (call.usage.reasoningTokens > 0) slice.reasoningTokens = (slice.reasoningTokens ?? 0) + call.usage.reasoningTokens
          slice.cacheReadTokens! += call.usage.cacheReadInputTokens
          slice.cacheWriteTokens! += call.usage.cacheCreationInputTokens

          const sliceProject = ensureProject(slice, session.project, project.projectPath)
          sliceProject.cost += call.costUSD
          sliceProject.calls += 1
          sliceProject.savingsUSD += callSavings

          const sliceModel = slice.models![modelKey] ?? {
            calls: 0, cost: 0, savingsUSD: 0,
            inputTokens: 0, outputTokens: 0,
            cacheReadTokens: 0, cacheWriteTokens: 0,
          }
          sliceModel.calls += 1
          sliceModel.cost += call.costUSD
          sliceModel.savingsUSD += callSavings
          sliceModel.inputTokens += call.usage.inputTokens
          sliceModel.outputTokens += call.usage.outputTokens
          if (call.usage.reasoningTokens > 0) sliceModel.reasoningTokens = (sliceModel.reasoningTokens ?? 0) + call.usage.reasoningTokens
          sliceModel.cacheReadTokens += call.usage.cacheReadInputTokens
          sliceModel.cacheWriteTokens += call.usage.cacheCreationInputTokens
          if (call.modelProvider) sliceModel.modelProvider = call.modelProvider
          addSourceProvider(sliceModel, call.provider)
          slice.models![modelKey] = sliceModel
        }
      }
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function buildPeriodDataFromDays(days: DailyEntry[], label: string): PeriodData {
  let cost = 0, savingsUSD = 0, calls = 0, sessions = 0
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0
  let reasoningTokens = 0
  let hasReasoningTokens = false
  const catTotals: Record<string, { turns: number; cost: number; savingsUSD: number; editTurns: number; oneShotTurns: number }> = {}
  const modelTotals: Record<string, {
    calls: number
    cost: number
    savingsUSD: number
    inputTokens: number
    outputTokens: number
    reasoningTokens?: number
    cacheReadTokens: number
    cacheWriteTokens: number
    modelProvider?: string
    sourceProviders?: string[]
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
          ...(d.reasoningTokens !== undefined ? { reasoningTokens: d.reasoningTokens } : {}),
          cacheReadTokens: d.cacheReadTokens,
          cacheWriteTokens: d.cacheWriteTokens,
        }
      }),
  }
}
