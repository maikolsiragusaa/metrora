import { formatUsd } from '../lib/format'
import type { MenubarPayload } from '../lib/types'
import { mean, type SignalGroups } from './overviewTrends'

export type OverviewDecisionTone = 'neutral' | 'good' | 'warn' | 'bad'
export type OverviewDecisionTarget = 'optimize' | 'sessions'

export type OverviewDecisionFact = {
  label: string
  value: string
  detail: string
  tone: OverviewDecisionTone
  target?: OverviewDecisionTarget
}

export type OverviewDecision = {
  comparison: OverviewDecisionFact
  driver: OverviewDecisionFact
  quality: OverviewDecisionFact
  warning: OverviewDecisionFact
  nextAction: OverviewDecisionFact & { target?: OverviewDecisionTarget }
}

type DriverCandidate = {
  kind: 'Model' | 'Project' | 'Activity'
  name: string
  cost: number
}

function comparisonFact(data: MenubarPayload, rangeActive: boolean): OverviewDecisionFact {
  if (rangeActive) {
    return {
      label: 'Change',
      value: 'Custom range',
      detail: 'Automatic prior-window comparison is suppressed for custom dates.',
      tone: 'neutral',
    }
  }

  const recent14 = data.history.daily.slice(-14)
  if (recent14.length < 14) {
    return {
      label: 'Change',
      value: 'No baseline yet',
      detail: 'Fourteen recorded daily entries are required for a 7-day comparison.',
      tone: 'neutral',
    }
  }

  const currentAverage = mean(recent14.slice(-7).map(day => day.cost))
  const priorAverage = mean(recent14.slice(0, 7).map(day => day.cost))
  if (priorAverage <= 0) {
    return {
      label: 'Change',
      value: 'No prior spend',
      detail: 'The previous 7-day window has no spend to compare against.',
      tone: 'neutral',
    }
  }

  const delta = (currentAverage - priorAverage) / priorAverage * 100
  const rounded = Math.round(Math.abs(delta))
  const direction = delta >= 0 ? 'higher' : 'lower'
  return {
    label: 'Change',
    value: `${rounded}% ${direction}`,
    detail: `Average daily spend is ${direction} than last week.`,
    tone: delta > 25 ? 'warn' : delta < -10 ? 'good' : 'neutral',
  }
}

function driverFact(data: MenubarPayload, rangeActive: boolean): OverviewDecisionFact {
  const candidates: DriverCandidate[] = []
  const model = data.current.topModels[0]
  const project = data.current.topProjects[0]
  const activity = data.current.topActivities[0]
  if (model) candidates.push({ kind: 'Model', name: model.name, cost: model.cost })
  if (project) candidates.push({ kind: 'Project', name: project.name, cost: project.cost })
  if (activity) candidates.push({ kind: 'Activity', name: activity.name, cost: activity.cost })
  const driver = candidates.sort((a, b) => b.cost - a.cost)[0]

  if (!driver) {
    return {
      label: 'Top driver',
      value: 'No driver yet',
      detail: 'No model, project or activity has cost in this scope.',
      tone: 'neutral',
    }
  }

  const share = data.current.cost > 0 ? driver.cost / data.current.cost * 100 : null
  const evidence = `${driver.kind} · ${formatUsd(driver.cost)}${share === null ? '' : ` · ${Math.round(share)}% of spend`}`
  return {
    label: 'Top driver',
    value: driver.name,
    detail: rangeActive ? `${driver.name} is the biggest driver in this range. ${evidence}` : evidence,
    tone: 'neutral',
    target: 'sessions',
  }
}

function qualityFact(data: MenubarPayload): OverviewDecisionFact {
  const coverage = data.current.pricingCoverage
  if (typeof coverage !== 'number') {
    return {
      label: 'Data quality',
      value: 'Coverage unknown',
      detail: 'This payload does not report pricing coverage, so cost completeness is not asserted.',
      tone: 'warn',
    }
  }
  if (coverage < 1) {
    const percent = Math.max(0, Math.min(99, Math.round(coverage * 100)))
    return {
      label: 'Data quality',
      value: `${percent}% priced`,
      detail: 'Share of cost-bearing calls that resolved a price.',
      tone: 'warn',
    }
  }
  return {
    label: 'Data quality',
    value: 'Fully priced',
    detail: 'All cost-bearing calls in this scope resolved a price.',
    tone: 'good',
  }
}

function warningFact(data: MenubarPayload, signals: SignalGroups): OverviewDecisionFact {
  const quality = qualityFact(data)
  if (quality.tone === 'warn') {
    return {
      label: 'Material warning',
      value: quality.value,
      detail: quality.detail,
      tone: 'warn',
    }
  }
  const risk = signals.risks[0]
  if (risk) {
    return {
      label: 'Material warning',
      value: risk.text,
      detail: 'Derived from the current standard comparison window.',
      tone: 'warn',
    }
  }
  return {
    label: 'Material warning',
    value: 'No material warning',
    detail: 'No current data-quality or spend-risk rule cleared its threshold.',
    tone: 'good',
  }
}

function nextActionFact(data: MenubarPayload, warning: OverviewDecisionFact, driver: OverviewDecisionFact): OverviewDecisionFact & { target?: OverviewDecisionTarget } {
  if (data.optimize.savingsUSD > 0) {
    return {
      label: 'Next safe action',
      value: 'Review recoverable spend',
      detail: `${formatUsd(data.optimize.savingsUSD)} is currently identified by existing optimization findings.`,
      tone: 'neutral',
      target: 'optimize',
    }
  }
  if (warning.tone === 'warn' && driver.target) {
    return {
      label: 'Next safe action',
      value: 'Inspect expensive sessions',
      detail: 'Open the underlying session report before changing workflow or model routing.',
      tone: 'neutral',
      target: 'sessions',
    }
  }
  if (driver.target) {
    return {
      label: 'Next safe action',
      value: 'Inspect the top driver',
      detail: 'Open the session report that explains the current leading cost source.',
      tone: 'neutral',
      target: 'sessions',
    }
  }
  return {
    label: 'Next safe action',
    value: 'No action needed',
    detail: 'More recorded activity is required before Metrora can suggest a grounded drill-down.',
    tone: 'good',
  }
}

export function deriveOverviewDecision(data: MenubarPayload, signals: SignalGroups, rangeActive: boolean): OverviewDecision {
  const driver = driverFact(data, rangeActive)
  const warning = warningFact(data, signals)
  return {
    comparison: comparisonFact(data, rangeActive),
    driver,
    quality: qualityFact(data),
    warning,
    nextAction: nextActionFact(data, warning, driver),
  }
}
