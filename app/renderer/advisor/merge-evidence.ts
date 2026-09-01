import type { AdvisorCoverageLevel, AdvisorEvidence } from './types'

function sameEvidenceContext(left: AdvisorEvidence['scope'], right: AdvisorEvidence['scope']): boolean {
  return left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
}

function localYesterday(): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - 1)
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function isDerivedYesterday(scope: AdvisorEvidence['scope']): boolean {
  return scope.period === 'today'
    && scope.range?.from === localYesterday()
    && scope.range.to === scope.range.from
}

/** Periods are comparable only when the factual provider/project/model
 * context is unchanged and the reads use the bounded period vocabulary. */
export function compatibleEvidenceScope(left: AdvisorEvidence['scope'], right: AdvisorEvidence['scope']): boolean {
  if (!sameEvidenceContext(left, right)) return false
  if (left.period === right.period) {
    return (left.range?.from === right.range?.from && left.range?.to === right.range?.to)
      || (left.range === null && isDerivedYesterday(right))
      || (right.range === null && isDerivedYesterday(left))
  }
  // A bounded comparison may contain one aggregate period and one derived
  // relative-day range (for example, a selected week plus yesterday). The
  // tool contract prevents arbitrary range changes, so a temporal mismatch is
  // safe to combine only when at least one side has no explicit range. Two
  // independent explicit ranges remain incompatible.
  return left.range === null || right.range === null
}

export function sameEvidenceScope(left: AdvisorEvidence['scope'], right: AdvisorEvidence['scope']): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}

export function hasMixedEvidenceScopes(items: AdvisorEvidence[]): boolean {
  return items.length > 1 && items.some(item => !compatibleEvidenceScope(item.scope, items[0]!.scope))
}

export function mergeEvidence(items: AdvisorEvidence[], fallback: AdvisorEvidence): AdvisorEvidence {
  if (hasMixedEvidenceScopes(items)) {
    return {
      intent: 'unknown',
      question: fallback.question,
      scope: fallback.scope,
      refs: [],
      coverage: { level: 'unavailable', label: 'Conflicting evidence scopes', detail: 'Tool evidence from different scopes was rejected instead of being combined.' },
      assumptions: [],
      unknown: ['The local model requested evidence from different scopes; no cross-scope facts were combined.'],
      nextInvestigations: ['Repeat the investigation with one explicit period, Project, provider, and model scope.'],
    }
  }
  const last = items[items.length - 1]!
  // Coverage is earned by canonical evidence, not by a model closeout. A
  // nominal high label without evidence refs is therefore unavailable.
  const usable = items.filter(item => item.coverage.level !== 'unavailable' && item.refs.length > 0)
  const level: AdvisorCoverageLevel = items.length > 0 && items.every(item => item.coverage.level === 'high' && item.refs.length > 0)
    ? 'high'
    : usable.length
      ? 'partial'
      : 'unavailable'
  const coverage = level === 'high'
    ? { level: 'high' as const, label: 'High coverage', detail: 'All requested evidence tools returned usable canonical records.' }
    : level === 'partial'
      ? { level: 'partial' as const, label: 'Partial coverage', detail: 'Some requested evidence is usable; other dimensions remain limited or unavailable.' }
      : { level: 'unavailable' as const, label: 'Unavailable', detail: 'The requested canonical evidence was not available.' }
  const unique = <T>(values: T[]) => Array.from(new Set(values))
  const refs = Array.from(new Map(items.flatMap(item => item.refs).map(ref => [ref.id + '|' + ref.label, ref])).values())
  const spendRows = items.flatMap(item => item.spend ? [item.spend] : [])
  const modelRows = items.flatMap(item => item.modelEfficiency ? [item.modelEfficiency] : [])
  const quotaRows = items.flatMap(item => item.quota ? [item.quota] : [])
  const spend = spendRows[0] ? {
    ...spendRows[0],
    models: unique(spendRows.flatMap(item => item.models.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.models).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
    projects: unique(spendRows.flatMap(item => item.projects.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.projects).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
    sessionsByCost: unique(spendRows.flatMap(item => item.sessionsByCost.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.sessionsByCost).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
  } : undefined
  const modelEfficiency = modelRows[0] ? {
    ...modelRows[modelRows.length - 1],
    rows: unique(modelRows.flatMap(item => item.rows.map(row => row.provider + '|' + row.model)).map(key => modelRows.flatMap(item => item.rows).find(row => row.provider + '|' + row.model === key)!)),
    comparableWorkWarning: modelRows.some(item => item.comparableWorkWarning),
  } : undefined
  const quota = quotaRows[0] ? {
    ...quotaRows[quotaRows.length - 1],
    providers: unique(quotaRows.flatMap(item => item.providers.map(row => row.provider)).map(provider => quotaRows.flatMap(item => item.providers).find(row => row.provider === provider)!)),
  } : undefined
  return {
    ...last,
    refs,
    coverage,
    assumptions: unique(items.flatMap(item => item.assumptions)),
    unknown: unique(items.flatMap(item => item.unknown)),
    nextInvestigations: unique(items.flatMap(item => item.nextInvestigations)),
    ...(modelEfficiency ? { modelEfficiency } : {}),
    ...(quota ? { quota } : {}),
    ...(spend ? {
      spend: {
        ...spend,
        history: spendRows.flatMap(item => item.history).slice(-30),
        modelHistory: spendRows.flatMap(item => item.modelHistory).slice(-8),
      },
    } : {}),
    domainCoverage: Array.from(new Map(items.flatMap(item => item.domainCoverage ?? []).map(item => [item.domain, item])).values()),
  }
}
