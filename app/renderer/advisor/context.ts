import type { Section } from '../lib/desktopNavigation'
import type { DateRange, Period } from '../lib/types'
import { snapshotAdvisorScope } from './contract'
import type { AdvisorScope } from './types'

export const ADVISOR_CONTEXTUAL_LAUNCH_CONTRACT_VERSION = 'advisor-contextual-launch-v1' as const
export const ADVISOR_CONTEXTUAL_LAUNCH_SCHEMA_VERSION = 1 as const

/**
 * These are the only Desktop surfaces that currently have a truthful,
 * page-level investigation in the Advisor contract. The other destinations
 * either have no shared accounting scope or expose object state that Advisor
 * cannot represent without inventing another evidence contract.
 */
export type AdvisorContextualSurface = 'overview' | 'sessions' | 'spend' | 'models' | 'compare' | 'plans'

export type AdvisorContextualLaunchV1 = {
  contractVersion: typeof ADVISOR_CONTEXTUAL_LAUNCH_CONTRACT_VERSION
  schemaVersion: typeof ADVISOR_CONTEXTUAL_LAUNCH_SCHEMA_VERSION
  originatingSection: AdvisorContextualSurface
  period: Period
  range: DateRange | null
  provider: string
  projectId: string
  projectName: string
  /** Exact model identity only. `null` means page scope, not “all renderer models”. */
  model: string | null
  /** Metrora-owned copy; this is a prompt seed, never an answer or claim. */
  suggestedPrompt: string | null
}

export type AdvisorContextualLaunchInput = {
  originatingSection: Section
  period: Period
  range: DateRange | null
  provider: string
  projectId: string
  projectName: string
  model?: string | null
}

const SURFACE_PROMPTS: Readonly<Record<AdvisorContextualSurface, string>> = Object.freeze({
  overview: 'Give me a measured overview of this scope and what changed most.',
  sessions: 'Which sessions or Projects explain the most measured spend in this scope?',
  spend: 'What changed in measured spend in this scope, and which drivers are visible?',
  models: 'Which models have the lowest observed cost per call in this scope?',
  compare: 'Investigate the observed model-efficiency evidence in this scope.',
  plans: 'What provider quota remains and when does it reset in this scope?',
})

const SURFACES: readonly AdvisorContextualSurface[] = Object.freeze([
  'overview',
  'sessions',
  'spend',
  'models',
  'compare',
  'plans',
])

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const MAX_IDENTIFIER_LENGTH = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isContextualSurface(value: unknown): value is AdvisorContextualSurface {
  return typeof value === 'string' && (SURFACES as readonly string[]).includes(value)
}

function boundedModel(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH || CONTROL_CHARACTERS.test(normalized)) return null
  return normalized
}

/** Returns whether a Desktop section can safely expose the page-level launch. */
export function isAdvisorContextualSurface(section: Section | string): section is AdvisorContextualSurface {
  return isContextualSurface(section)
}

/** Human-readable origin label used only by the Advisor shell. */
export function advisorContextualSurfaceLabel(surface: AdvisorContextualSurface): string {
  if (surface === 'overview') return 'Home'
  return surface.charAt(0).toUpperCase() + surface.slice(1)
}

/**
 * Projects Desktop state into the narrow contextual handoff. No page payload,
 * renderer selection state, factual prose, or evidence is accepted here.
 * Invalid optional model state degrades to the nearest truthful page scope.
 */
export function createAdvisorContextualLaunch(input: AdvisorContextualLaunchInput): AdvisorContextualLaunchV1 | null {
  if (!isContextualSurface(input.originatingSection)) return null

  try {
    const scope = snapshotAdvisorScope({
      period: input.period,
      range: input.range ? { from: input.range.from, to: input.range.to } : null,
      provider: input.provider,
      projectId: input.projectId,
      projectName: input.projectName,
      model: boundedModel(input.model),
    })

    return Object.freeze({
      contractVersion: ADVISOR_CONTEXTUAL_LAUNCH_CONTRACT_VERSION,
      schemaVersion: ADVISOR_CONTEXTUAL_LAUNCH_SCHEMA_VERSION,
      originatingSection: input.originatingSection,
      period: scope.period,
      range: scope.range,
      provider: scope.provider,
      projectId: scope.projectId,
      projectName: scope.projectName,
      model: scope.model,
      suggestedPrompt: SURFACE_PROMPTS[input.originatingSection] ?? null,
    })
  } catch {
    // A malformed handoff must not create an Advisor scope from partial UI
    // state. The page simply has no contextual affordance in that case.
    return null
  }
}

/**
 * Re-validates a launch at the Advisor boundary and reconstructs it from the
 * allowlisted fields. This also prevents a future caller from smuggling a
 * renderer payload or arbitrary prose through a structurally compatible cast.
 */
export function normalizeAdvisorContextualLaunch(value: unknown): AdvisorContextualLaunchV1 | null {
  if (!isRecord(value)) return null
  if (value.contractVersion !== ADVISOR_CONTEXTUAL_LAUNCH_CONTRACT_VERSION || value.schemaVersion !== ADVISOR_CONTEXTUAL_LAUNCH_SCHEMA_VERSION) return null
  if (!isContextualSurface(value.originatingSection)) return null

  return createAdvisorContextualLaunch({
    originatingSection: value.originatingSection,
    period: value.period as Period,
    range: value.range as DateRange | null,
    provider: value.provider as string,
    projectId: value.projectId as string,
    projectName: value.projectName as string,
    model: value.model as string | null,
  })
}

export function advisorScopeFromContextualLaunch(value: unknown): AdvisorScope | null {
  const launch = normalizeAdvisorContextualLaunch(value)
  if (!launch) return null
  return snapshotAdvisorScope({
    period: launch.period,
    range: launch.range ? { from: launch.range.from, to: launch.range.to } : null,
    provider: launch.provider,
    projectId: launch.projectId,
    projectName: launch.projectName,
    model: launch.model,
  })
}
