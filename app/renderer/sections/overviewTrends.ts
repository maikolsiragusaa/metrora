import { formatUsd } from '../lib/format'
import { localDateKey } from '../lib/period'
import type { DailyHistoryEntry, MenubarPayload } from '../lib/types'

export type Signal = { text: string; trailing?: string }
export type SignalGroups = { wins: Signal[]; improvements: Signal[]; risks: Signal[] }

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function streakDays(daily: DailyHistoryEntry[], now: Date): number {
  const byDate = new Map(daily.map(day => [day.date, day.cost]))
  let streak = 0
  for (let offset = 0; ; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    if ((byDate.get(localDateKey(date)) ?? 0) <= 0) break
    streak++
  }
  return streak
}

export function deriveStats(data: MenubarPayload, now: Date) {
  const daily = data.history.daily
  const todayKey = localDateKey(now)
  const todayEntry = daily.find(day => day.date === todayKey)
  const monthPrefix = todayKey.slice(0, 7)
  const mtdEntries = daily.filter(day => day.date.startsWith(monthPrefix))
  const mtd = mtdEntries.reduce((sum, day) => sum + day.cost, 0)
  const medianDaily = median(daily.slice(-7).map(day => day.cost))
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const projected = mtd + medianDaily * Math.max(0, daysInMonth - now.getDate())
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevPrefix = localDateKey(prevMonth).slice(0, 7)
  const priorEntries = daily.filter(day => day.date.startsWith(prevPrefix))
  const priorAverage = mean(priorEntries.map(day => day.cost))
  const currentAverage = mean(mtdEntries.map(day => day.cost))
  const pacePct = priorAverage > 0 ? ((currentAverage - priorAverage) / priorAverage) * 100 : null

  return {
    todayEntry,
    todayCost: todayEntry?.cost ?? 0,
    mtd,
    projected,
    pacePct,
    prevMonthName: prevMonth.toLocaleString('en-US', { month: 'long' }),
  }
}

export function deriveSignals(data: MenubarPayload, now: Date, rangeActive: boolean): SignalGroups {
  const daily = data.history.daily
  const current = data.current
  const wins: Signal[] = []
  const improvements: Signal[] = []
  const risks: Signal[] = []
  const streak = streakDays(daily, now)

  let weekDelta: number | null = null
  if (daily.length >= 14) {
    const recent14 = daily.slice(-14)
    const weekNow = mean(recent14.slice(-7).map(day => day.cost))
    const weekPrior = mean(recent14.slice(0, 7).map(day => day.cost))
    if (weekPrior > 0) weekDelta = (weekNow - weekPrior) / weekPrior * 100
  }

  const todayKey = localDateKey(now)
  const monthPrefix = todayKey.slice(0, 7)
  const mtd = daily.filter(day => day.date.startsWith(monthPrefix)).reduce((sum, day) => sum + day.cost, 0)
  const medianDaily = median(daily.slice(-7).map(day => day.cost))
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const projectedMonth = mtd + medianDaily * Math.max(0, daysInMonth - now.getDate())
  const prevPrefix = localDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7)
  const prevMonthTotal = daily.filter(day => day.date.startsWith(prevPrefix)).reduce((sum, day) => sum + day.cost, 0)

  const today = daily.find(day => day.date === todayKey)
  const sameWeekdayCosts = daily
    .filter(day => {
      if (day.date === todayKey) return false
      const [year, month, date] = day.date.split('-').map(Number)
      return new Date(year, month - 1, date).getDay() === now.getDay()
    })
    .map(day => day.cost)
  const typicalWeekday = mean(sameWeekdayCosts)

  if (current.cacheHitPercent >= 80) wins.push({ text: `Cache hit at ${Math.round(current.cacheHitPercent)}%, most prompts reuse cache` })
  if (current.oneShotRate !== null && current.oneShotRate >= 0.75) wins.push({ text: `${Math.round(current.oneShotRate * 100)}% one-shot, edits land first try` })
  if (!rangeActive && weekDelta !== null && weekDelta < -10) wins.push({ text: `Spend down ${Math.round(Math.abs(weekDelta))}% vs last 7 days` })
  if (streak >= 5) wins.push({ text: `${streak}-day usage streak` })
  if (current.localModelSavings.totalUSD > 0) wins.push({ text: `${formatUsd(current.localModelSavings.totalUSD)} saved via local models` })

  for (const finding of data.optimize.topFindings.slice(0, 3)) improvements.push({ text: finding.title, trailing: formatUsd(finding.savingsUSD) })
  if (current.cacheHitPercent > 0 && current.cacheHitPercent < 50) improvements.push({ text: `Cache hit only ${Math.round(current.cacheHitPercent)}%, paying for cold prompts` })
  if (current.oneShotRate !== null && current.oneShotRate < 0.5) improvements.push({ text: `${Math.round(current.oneShotRate * 100)}% one-shot, lots of iteration` })
  const retryShare = current.retryTax.totalUSD / Math.max(current.cost, 1e-9)
  if (retryShare >= 0.25) improvements.push({ text: `Retry tax is ${Math.round(retryShare * 100)}% of spend` })

  if (today && typicalWeekday > 0 && today.cost > typicalWeekday * 1.8) {
    const ratio = today.cost / typicalWeekday
    const weekday = now.toLocaleString('en-US', { weekday: 'long' })
    risks.push({ text: `Today's spend is ${ratio.toFixed(1).replace(/\.0$/, '')}× your typical ${weekday}` })
  }
  if (!rangeActive && weekDelta !== null && weekDelta > 25) risks.push({ text: `Spend up ${Math.round(weekDelta)}% vs prior 7 days` })
  if (!rangeActive && prevMonthTotal > 0 && projectedMonth > prevMonthTotal * 1.3) {
    const overPct = Math.round((projectedMonth - prevMonthTotal) / prevMonthTotal * 100)
    risks.push({ text: `On pace for ${formatUsd(projectedMonth)} this month, +${overPct}% vs last` })
  }

  return { wins: wins.slice(0, 3), improvements: improvements.slice(0, 3), risks: risks.slice(0, 3) }
}
