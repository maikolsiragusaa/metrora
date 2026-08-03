import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/usage-aggregator.ts'
let text = readFileSync(path, 'utf8')

function replaceOnce(oldText, newText, label) {
  const first = text.indexOf(oldText)
  const second = first < 0 ? -1 : text.indexOf(oldText, first + oldText.length)
  if (first < 0 || second >= 0) {
    throw new Error(`${label}: expected exactly one match`)
  }
  text = text.slice(0, first) + newText + text.slice(first + oldText.length)
}

replaceOnce(
  "import { aggregateProjectsIntoDays, buildPeriodDataFromDays } from './day-aggregator.js'",
  `import { aggregateProjectsIntoDays, buildPeriodDataFromDays } from './day-aggregator.js'
import {
  durableProjectDisplayName,
  hasDurableProjectFilter,
  reconcileDurableProjectDay,
  sliceDayToProvider,
} from './durable-project-reconciliation.js'`,
  'durable reconciliation import',
)

const providerStart = text.indexOf("/// Collapse a day to a single provider's slice")
const providerEnd = text.indexOf("/// The durable day set behind a period's headline", providerStart)
if (providerStart < 0 || providerEnd < 0) throw new Error('provider slice extraction markers missing')
text = text.slice(0, providerStart) + text.slice(providerEnd)

const oldFilter = `  const fp = (p: ProjectSummary[]) => filterProjectsByName(p, opts.project ?? [], opts.exclude ?? [])

  const now = new Date()`
const durableFunction = text.indexOf('export async function buildDurablePeriod')
const menubarFunction = text.indexOf('export async function buildMenubarPayloadForRange')
if (durableFunction < 0 || menubarFunction < 0) throw new Error('aggregation function markers missing')

let beforeMenubar = text.slice(0, menubarFunction)
let fromMenubar = text.slice(menubarFunction)
if (beforeMenubar.split(oldFilter).length !== 2) throw new Error('durable project filter insertion point changed')
beforeMenubar = beforeMenubar.replace(
  oldFilter,
  `  const fp = (p: ProjectSummary[]) => filterProjectsByName(p, opts.project ?? [], opts.exclude ?? [])
  const projectFilter = { include: opts.project, exclude: opts.exclude }

  const now = new Date()`,
)
text = beforeMenubar + fromMenubar

replaceOnce(
  `  const allDays = unionDaysForPeriod(cache, todayAllDays, periodInfo, daysSelection?.days ?? null)
  const days = pf === 'all' ? allDays : allDays.map(d => sliceDayToProvider(d, pf))
  const data = buildPeriodDataFromDays(days, periodInfo.label)`,
  `  const allDays = unionDaysForPeriod(cache, todayAllDays, periodInfo, daysSelection?.days ?? null)
  const projectFilterActive = hasDurableProjectFilter(projectFilter)
  const days = allDays.map(day => {
    const providerDay = pf === 'all' ? day : sliceDayToProvider(day, pf)
    return reconcileDurableProjectDay(providerDay, projectFilter, {
      preserveDetailedBreakdown: projectFilterActive && day.date === todayStr,
    })
  })
  const data = buildPeriodDataFromDays(days, periodInfo.label)`,
  'durable day projection',
)

const updatedMenubarFunction = text.indexOf('export async function buildMenubarPayloadForRange')
beforeMenubar = text.slice(0, updatedMenubarFunction)
fromMenubar = text.slice(updatedMenubarFunction)
if (fromMenubar.split(oldFilter).length !== 2) throw new Error('menubar project filter insertion point changed')
fromMenubar = fromMenubar.replace(
  oldFilter,
  `  const fp = (p: ProjectSummary[]) => filterProjectsByName(p, opts.project ?? [], opts.exclude ?? [])
  const projectFilter = { include: opts.project, exclude: opts.exclude }
  const projectFilterActive = hasDurableProjectFilter(projectFilter)

  const now = new Date()`,
)
text = beforeMenubar + fromMenubar

replaceOnce(
  `  } else if (isAllProviders) {
    const unfilteredProviderDays = [
      ...(rangeStartStr <= historicalRangeEndStr ? getDaysInRange(cache, rangeStartStr, historicalRangeEndStr) : []),
      ...(await getTodayAllDays()).filter(d => d.date >= rangeStartStr && d.date <= rangeEndStr),
    ]
    const allDaysForProviders = daysSelection ? unfilteredProviderDays.filter(d => daysSelection.days.has(d.date)) : unfilteredProviderDays
    const providerTotals: Record<string, number> = {}`,
  `  } else if (isAllProviders) {
    // The durable builder already applied period, day, provider and project
    // scopes. Reusing its exact day projection keeps provider totals aligned
    // with the headline instead of reading the unfiltered cache again.
    const allDaysForProviders = cacheDaysForPeriod ?? []
    const providerTotals: Record<string, number> = {}`,
  'provider totals projection',
)

const historyStart = text.indexOf('  let dailyHistory\n')
const historyEnd = text.indexOf('  const home = homedir()\n', historyStart)
if (historyStart < 0 || historyEnd < 0) throw new Error('daily history markers missing')
const historyBlock = `  let dailyHistory
  if (isClaudeConfigScoped && claudeConfigs?.selectedId) {
    const historyRange: DateRange = {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - BACKFILL_DAYS),
      end: now,
    }
    const historyProjects = filterProjectsByClaudeConfigSource(
      fp(await parseAllSessions(historyRange, 'claude')),
      claudeConfigs.selectedId,
    )
    dailyHistory = dailyEntriesToHistory(aggregateProjectsIntoDays(historyProjects))
  } else if (projectFilterActive) {
    // Historical project rollups own cost/calls/savings/session splits,
    // but not token/model/category splits. Keep those unavailable details empty
    // instead of assigning the whole day to every selected project. Today's
    // project-filtered live parse can preserve its detailed breakdown safely.
    const historyFromCache = allCacheDays.map(day => reconcileDurableProjectDay(
      isAllProviders ? day : sliceDayToProvider(day, pf),
      projectFilter,
    ))
    const todayFromParse = (await getTodayAllDays())
      .filter(day => day.date === todayStr)
      .map(day => reconcileDurableProjectDay(
        isAllProviders ? day : sliceDayToProvider(day, pf),
        projectFilter,
        { preserveDetailedBreakdown: true },
      ))
    dailyHistory = dailyEntriesToHistory([...historyFromCache, ...todayFromParse])
  } else if (isAllProviders) {
    const todayDays = (await getTodayAllDays()).filter(d => d.date === todayStr)
    const fullHistory = [...allCacheDays, ...todayDays]
    dailyHistory = dailyEntriesToHistory(fullHistory)
  } else {
    const emptyModels = [] as { name: string; cost: number; savingsUSD: number; calls: number; inputTokens: number; outputTokens: number }[]
    const historyFromCache = allCacheDays.map(d => {
      const prov = d.providers[pf] ?? { calls: 0, cost: 0, savingsUSD: 0 }
      return {
        date: d.date,
        cost: prov.cost,
        savingsUSD: prov.savingsUSD,
        calls: prov.calls,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        topModels: emptyModels,
      }
    })
    const todayFromParse = aggregateProjectsIntoDays(scanProjects)
      .filter(d => d.date === todayStr)
      .map(d => {
        const prov = d.providers[pf] ?? { calls: 0, cost: 0, savingsUSD: 0 }
        return {
          date: d.date,
          cost: prov.cost,
          savingsUSD: prov.savingsUSD,
          calls: prov.calls,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          topModels: emptyModels,
        }
      })
    dailyHistory = [...historyFromCache, ...todayFromParse]
  }

`
text = text.slice(0, historyStart) + historyBlock + text.slice(historyEnd)

replaceOnce(
  `    // Project totals come from the SAME day set as the headline, so carried
    // days count here too. The surviving-session parse contributes only what
    // day entries cannot: the per-session drill-down and a fresher project
    // path. Days recorded before the projects rollup existed have totals but
    // no project split, so this list can sum to less than the headline — an
    // honest gap, not a bug.`,
  `    // Project totals come from the SAME day set as the headline, so carried
    // days count here too. The surviving-session parse contributes only what
    // day entries cannot: the per-session drill-down and a fresher project
    // path. Legacy residuals without a project split are represented by the
    // synthetic Unattributed bucket, never assigned to a real project.`,
  'project breakdown comment',
)

replaceOnce(
  'name: live ? friendlyProject(live) : friendlyFromPath(cached?.path, name),',
  'name: live ? friendlyProject(live) : friendlyFromPath(cached?.path, durableProjectDisplayName(name)),',
  'unattributed display label',
)

writeFileSync(path, text)
