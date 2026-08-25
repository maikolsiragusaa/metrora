import type {
  AdvisorAnswer,
  AdvisorBenchRun,
  AdvisorCoverage,
  AdvisorEvidence,
  AdvisorEvidenceRef,
  AdvisorJsonObject,
  AdvisorJsonValue,
  AdvisorPresentationBlockV1,
  AdvisorPresentationIntent,
  AdvisorScope,
  AdvisorSynthesisBlockV1,
  AdvisorSynthesisDraftV1,
  AdvisorVerifiedClaimAtomV1,
} from './types'

/**
 * The privacy boundary is intentionally conservative. It is used for values
 * that may cross into a model/tool payload, not for canonical evidence kept
 * inside Metrora. A redaction is explicit; it never invents a replacement.
 */
export const ADVISOR_MODEL_NARRATIVE_MAX_BYTES = 8 * 1024
export const ADVISOR_ANSWER_TEXT_MAX_BYTES = 8 * 1024
export const ADVISOR_CONTENT_MINIMAL_TEXT_MAX_LENGTH = 160

const REDACTION = '[redacted]'
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

// Only roots that are materially indicative of local filesystem provenance
// are classified here. Names such as "project/alpha" remain valid display
// names; a generic slash is not enough to make a project name sensitive.
const PATH_PATTERN = /(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|(?:^|[\s([{])\\\\[^\s"'<>|]+|(?:^|[\s([{])(?:~[\\/]|\/(?:Users|users|home|private|var|tmp|mnt|opt|root|srv|workspace|workspaces)(?:\/|$))[^\s"'<>|,.;!?)]*|\b(?:file|local|vscode-file):\/\/[^\s"'<>|]+|(?:^|[\s([{])(?:\.\.?[\\/])[^\s"'<>|,.;!?)]*)/giu
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu
const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/giu
const KEY_PREFIX_PATTERN = /\b(?:sk|rk|pk|gh[pousr]|xox[baprs]-)[-_A-Za-z0-9]{12,}\b/giu
const RAW_CONTENT_MARKER_PATTERN = /(?<![\p{L}\p{N}])(?:raw[_ -]?(?:prompt|response|source)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*|(?:prompt|response|source)[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*|source[_ -]?(?:code|snippet|content|snippets?)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*)(?![\p{L}\p{N}])/giu
const NUMERIC_CHARACTER_PATTERN = /\p{N}/u
const NUMBER_WORD_PATTERN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million|billion|first|second|third|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|primo|secondo|terzo)\b/iu
const CONTENT_MINIMAL_EVIDENCE_SOURCES = ['overview', 'history', 'models', 'quota', 'bench'] as const
const CONTENT_MINIMAL_PROVIDER_NAMES = ['all', 'claude', 'codex'] as const
const SAFE_ANSWER_EVIDENCE_ID_PATTERN = /^(?:spend|quota|spend-(?:claude|codex)|overview\.(?:current|history\.daily|models|projects|sessions|modelAccounting)|models\.report|quota\.(?:claude|codex)|bench\.(?:latest|history|comparison))$/u
const CLAIM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/u

function contentMinimalSource(value: unknown): typeof CONTENT_MINIMAL_EVIDENCE_SOURCES[number] | null {
  return typeof value === 'string' && (CONTENT_MINIMAL_EVIDENCE_SOURCES as readonly string[]).includes(value) ? value as typeof CONTENT_MINIMAL_EVIDENCE_SOURCES[number] : null
}
function contentMinimalProvider(value: unknown): typeof CONTENT_MINIMAL_PROVIDER_NAMES[number] | null {
  return typeof value === 'string' && (CONTENT_MINIMAL_PROVIDER_NAMES as readonly string[]).includes(value) ? value as typeof CONTENT_MINIMAL_PROVIDER_NAMES[number] : null
}
function contentMinimalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function entropy(value: string): number {
  if (!value) return 0
  const counts = new Map<string, number>()
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1)
  let result = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    result -= probability * Math.log2(probability)
  }
  return result
}

function looksLikeHighEntropyCredential(value: string): boolean {
  if (value.length < 20 || /\s/u.test(value)) return false
  if (!/^[\p{L}\p{N}+/_=-]+$/u.test(value)) return false
  const classes = Number(/[\p{Ll}]/u.test(value)) + Number(/[\p{Lu}]/u.test(value)) + Number(/[\p{N}]/u.test(value)) + Number(/[+/_=-]/u.test(value))
  return value.length >= 24 && classes >= 1 && entropy(value) >= 3.6
}
function containsAdvisorNumericClaim(value: string): boolean {
  return NUMERIC_CHARACTER_PATTERN.test(value) || NUMBER_WORD_PATTERN.test(value)
}

function resetPatterns(): void {
  PATH_PATTERN.lastIndex = 0
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
  BEARER_PATTERN.lastIndex = 0
  KEY_PREFIX_PATTERN.lastIndex = 0
  RAW_CONTENT_MARKER_PATTERN.lastIndex = 0
}

function replaceSensitiveSegments(value: string): string {
  let result = value
  result = result.replace(PATH_PATTERN, REDACTION)
  result = result.replace(SECRET_ASSIGNMENT_PATTERN, REDACTION)
  result = result.replace(BEARER_PATTERN, REDACTION)
  result = result.replace(KEY_PREFIX_PATTERN, REDACTION)
  result = result.replace(RAW_CONTENT_MARKER_PATTERN, REDACTION)
  result = result.split(/(\s+)/u).map(token => looksLikeHighEntropyCredential(token) ? REDACTION : token).join('')
  resetPatterns()
  return result
}

export function containsAdvisorSensitiveText(value: string): boolean {
  if (!value) return false
  const matched = PATH_PATTERN.test(value) || SECRET_ASSIGNMENT_PATTERN.test(value) || BEARER_PATTERN.test(value) || KEY_PREFIX_PATTERN.test(value) || RAW_CONTENT_MARKER_PATTERN.test(value)
  resetPatterns()
  return matched || value.split(/\s+/u).some(looksLikeHighEntropyCredential)
}

/** Redacts sensitive spans while retaining safe factual text and digits. */
export function sanitizeAdvisorDisplayText(value: string, maxLength = ADVISOR_CONTENT_MINIMAL_TEXT_MAX_LENGTH): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized) return REDACTION
  const redacted = replaceSensitiveSegments(normalized).replace(/\s{2,}/gu, ' ').trim()
  if (!redacted) return REDACTION
  if (redacted.length <= maxLength) return redacted
  return redacted.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…'
}

/**
 * Model prose has a stricter policy than human-facing deterministic facts:
 * any numeric claim or sensitive class invalidates the whole narrative.
 */
export function sanitizeAdvisorNarrative(value: string, maxBytes = ADVISOR_MODEL_NARRATIVE_MAX_BYTES): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized || containsAdvisorNumericClaim(normalized) || containsAdvisorSensitiveText(normalized)) return ''
  const safe = sanitizeAdvisorDisplayText(normalized, Number.MAX_SAFE_INTEGER)
  if (safe === REDACTION || containsAdvisorSensitiveText(safe) || containsAdvisorNumericClaim(safe)) return ''
  if (byteLength(safe) <= maxBytes) return safe
  return ''
}

export function boundedAdvisorText(value: string, maxBytes = ADVISOR_ANSWER_TEXT_MAX_BYTES): string {
  if (byteLength(value) <= maxBytes) return value
  let end = value.length
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) end -= 1
  return value.slice(0, end)
}

export function contentMinimalScope(scope: AdvisorScope): AdvisorScope {
  return {
    period: scope.period,
    range: scope.range ? { from: scope.range.from, to: scope.range.to } : null,
    provider: contentMinimalProvider(scope.provider) ?? '[provider]',
    // Raw internal Project/account identities are not model-facing evidence.
    projectId: scope.projectId === 'all' ? 'all' : '[scoped-project]',
    projectName: sanitizeAdvisorDisplayText(scope.projectName),
    model: scope.model === null ? null : sanitizeAdvisorDisplayText(scope.model),
  }
}

export function contentMinimalCoverage(coverage: AdvisorCoverage): AdvisorCoverage {
  return {
    level: coverage.level,
    label: sanitizeAdvisorDisplayText(coverage.label),
    detail: sanitizeAdvisorDisplayText(coverage.detail),
    ...(coverage.state ? { state: coverage.state } : {}),
  }
}

function safeBenchIdentifier(value: string, digest = false): string {
  const pattern = digest ? /^[0-9a-f]{64}$/u : /^[A-Za-z0-9._:/-]{1,200}$/u
  return pattern.test(value) ? value : REDACTION
}

function contentMinimalBenchRun(run: AdvisorBenchRun): AdvisorJsonObject {
  return {
    runId: safeBenchIdentifier(run.runId),
    pack: { id: safeBenchIdentifier(run.pack.id), version: safeBenchIdentifier(run.pack.version), digest: safeBenchIdentifier(run.pack.digest, true) },
    scorer: { id: safeBenchIdentifier(run.scorer.id), version: safeBenchIdentifier(run.scorer.version) },
    runner: { id: safeBenchIdentifier(run.runner.id), version: safeBenchIdentifier(run.runner.version) },
    runtime: { id: safeBenchIdentifier(run.runtime.id), version: safeBenchIdentifier(run.runtime.version) },
    model: { selected: safeBenchIdentifier(run.model.selected), reported: run.model.reported === null ? null : safeBenchIdentifier(run.model.reported) },
    generationPolicy: safeBenchIdentifier(run.generationPolicy),
    status: run.status,
    aggregate: run.aggregate,
    tasks: run.tasks.slice(0, 64).map(task => ({
      taskId: safeBenchIdentifier(task.taskId),
      status: task.status,
      score: task.score,
      requestLatencyMs: task.requestLatencyMs,
      timeToFirstContentMs: task.timeToFirstContentMs,
    })),
    resultDigest: safeBenchIdentifier(run.resultDigest, true),
  }
}

export function contentMinimalEvidenceRefs(refs: AdvisorEvidenceRef[], options: { preserveIds?: boolean } = {}): AdvisorEvidenceRef[] {
  return refs.flatMap((ref, index) => {
    const source = contentMinimalSource(ref.source)
    if (!source) return []
    return [{
      // Evidence IDs are internal correlation keys. A stable local ordinal is
      // sufficient for the model and avoids exposing provider/account IDs.
      id: options.preserveIds && SAFE_ANSWER_EVIDENCE_ID_PATTERN.test(ref.id) ? ref.id : 'evidence-' + (index + 1),
      label: sanitizeAdvisorDisplayText(ref.label),
      source,
    }]
  })
}

export function sanitizeAdvisorAnswer(answer: AdvisorAnswer): AdvisorAnswer {
  const coverage = contentMinimalCoverage(answer.coverage)
  const safeText = (value: string) => boundedAdvisorText(sanitizeAdvisorDisplayText(value, Number.MAX_SAFE_INTEGER))
  const evidenceIdMap = new Map<string, string>()
  const evidence = answer.evidence.flatMap((ref, index) => {
    const source = contentMinimalSource(ref.source)
    if (!source) return []
    const candidate = sanitizeAdvisorDisplayText(ref.id, 64)
    const id = SAFE_ANSWER_EVIDENCE_ID_PATTERN.test(candidate) ? candidate : 'evidence-' + (index + 1)
    evidenceIdMap.set(ref.id, id)
    return [{ id, label: sanitizeAdvisorDisplayText(ref.label), source }]
  })
  const safeEvidenceRefs = (refs: AdvisorEvidenceRef[]): AdvisorEvidenceRef[] => refs.flatMap(ref => {
    const id = evidenceIdMap.get(ref.id) ?? (evidence.some(item => item.id === ref.id) ? ref.id : null)
    const source = contentMinimalSource(ref.source)
    return id && source ? [{ id, label: sanitizeAdvisorDisplayText(ref.label), source }] : []
  })
  const safeJsonValue = (value: AdvisorJsonValue, depth = 0): AdvisorJsonValue => {
    if (depth > 4) return null
    if (typeof value === 'string') return safeText(value)
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
    if (Array.isArray(value)) return value.slice(0, 32).map(item => safeJsonValue(item, depth + 1))
    return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, child]) => [sanitizeAdvisorDisplayText(key, 80), safeJsonValue(child, depth + 1)]))
  }
  const claimKinds = ['measured_total', 'observed_count', 'provider_quota_remaining', 'provider_quota_reset', 'model_identity', 'model_measured_cost', 'project_measured_cost', 'session_measured_cost', 'trend_direction', 'coverage_state', 'freshness_state', 'bench_score', 'bench_status', 'bench_comparability'] as const
  const safeClaims = (claims: AdvisorVerifiedClaimAtomV1[] | undefined): AdvisorVerifiedClaimAtomV1[] | undefined => {
    if (!claims) return undefined
    return claims.flatMap(claim => {
      if (claim.contractVersion !== 'advisor-verified-claim-atom-v1' || claim.schemaVersion !== 1 || claim.operator !== 'equals' || !claimKinds.includes(claim.claimKind) || !CLAIM_ID_PATTERN.test(claim.id)) return []
      const evidenceRef = evidenceIdMap.get(claim.evidenceRef) ?? claim.evidenceRef
      if (!evidence.some(item => item.id === evidenceRef)) return []
      return [{
        ...claim,
        value: safeJsonValue(claim.value),
        subject: claim.subject === null ? null : safeText(claim.subject),
        unit: claim.unit === null ? null : safeText(claim.unit),
        evidenceRef,
        evidencePath: /^[A-Za-z][A-Za-z0-9_.-]{0,160}$/u.test(claim.evidencePath) ? claim.evidencePath : 'invalid-path',
        scope: contentMinimalScope(claim.scope),
      }]
    }).slice(0, 24)
  }
  const safeClaimSelections = (claims: AdvisorSynthesisDraftV1['claims'] | undefined): AdvisorSynthesisDraftV1['claims'] | undefined => claims
    ? claims.flatMap(claim => CLAIM_ID_PATTERN.test(claim.id) ? [{ contractVersion: 'advisor-claim-selection-v1' as const, schemaVersion: 1 as const, id: claim.id }] : []).slice(0, 24)
    : undefined
  const presentationKinds: readonly AdvisorPresentationIntent[] = ['text', 'metric-cards', 'line-chart', 'bar-chart', 'comparison-table', 'quota-card', 'bench-summary', 'warning', 'evidence-disclosure']
  const safePresentation = (blocks: AdvisorPresentationBlockV1[] | undefined): AdvisorPresentationBlockV1[] | undefined => blocks ? blocks.flatMap((block): AdvisorPresentationBlockV1[] => {
    if (!presentationKinds.includes(block.kind)) return []
    if (block.kind === 'text') return [{ ...block, text: safeText(block.text), claimIds: block.claimIds.slice(0, 24) }]
    if (block.kind === 'metric-cards') return [{ ...block, title: safeText(block.title), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), cards: block.cards.slice(0, 8).map(card => ({ ...card, label: safeText(card.label), value: safeText(card.value), unit: safeText(card.unit), detail: safeText(card.detail), claimIds: card.claimIds.slice(0, 24) })) }]
    if (block.kind === 'line-chart' || block.kind === 'bar-chart') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), unit: safeText(block.unit), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), accessibilityLabel: safeText(block.accessibilityLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), series: block.series.slice(0, 8).map(series => ({ ...series, id: safeText(series.id), label: safeText(series.label), points: series.points.slice(-30).map(point => ({ label: safeText(point.label), value: point.value === null || Number.isFinite(point.value) ? point.value : null })) })) }]
    if (block.kind === 'comparison-table') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), table: { columns: block.table.columns.slice(0, 12).map(safeText), rows: block.table.rows.slice(0, 32).map(row => row.slice(0, 12).map(safeText)) } }]
    if (block.kind === 'quota-card') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), providers: block.providers.slice(0, 4).map(provider => ({ ...provider, planLabel: provider.planLabel === null ? null : safeText(provider.planLabel), observedAt: provider.observedAt === null ? null : safeText(provider.observedAt), windows: provider.windows.slice(0, 8).map((window, index) => ({ ...window, id: 'window-' + (index + 1), label: safeText(window.label), resetsAt: window.resetsAt === null ? null : safeText(window.resetsAt) })) })) }]
    if (block.kind === 'bench-summary') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), run: block.run === null ? null : contentMinimalBenchRun(block.run) as unknown as AdvisorBenchRun }]
    if (block.kind === 'warning' || block.kind === 'evidence-disclosure') return [{ ...block, title: safeText(block.title), text: safeText(block.text), evidenceRefs: safeEvidenceRefs(block.evidenceRefs) }]
    return []
  }) : undefined
  const claims = safeClaims(answer.claims)
  const synthesisClaims = safeClaimSelections(answer.synthesis?.claims)
  const safeSynthesisBlock = (block: AdvisorSynthesisBlockV1): AdvisorSynthesisBlockV1 => ({
    claimIds: block.claimIds.slice(0, 24),
    ...(block.emphasis ? { emphasis: block.emphasis } : {}),
  })
  const synthesis = answer.synthesis ? {
    ...answer.synthesis,
    conclusion: safeSynthesisBlock(answer.synthesis.conclusion),
    why: answer.synthesis.why.map(safeSynthesisBlock).slice(0, 6),
    details: answer.synthesis.details.map(safeSynthesisBlock).slice(0, 12),
    claims: synthesisClaims ?? [],
    presentationRequests: answer.synthesis.presentationRequests.filter(request => presentationKinds.includes(request.kind)).slice(0, 8).map(request => ({ ...request, ...(request.title ? { title: safeText(request.title) } : {}), ...(request.evidenceRefs ? { evidenceRefs: request.evidenceRefs.map(ref => evidenceIdMap.get(ref) ?? ref).filter(ref => evidence.some(item => item.id === ref)) } : {}) })),
    ...(answer.synthesis.expertDetail ? { expertDetail: answer.synthesis.expertDetail.map(safeText).slice(0, 8) } : {}),
  } : undefined
  return {
    ...answer,
    conclusion: safeText(answer.conclusion),
    scopeLabel: safeText(answer.scopeLabel),
    periodLabel: safeText(answer.periodLabel),
    evidence,
    coverage,
    assumptions: answer.assumptions.map(safeText),
    unknown: answer.unknown.map(safeText),
    nextInvestigations: answer.nextInvestigations.map(safeText),
    details: answer.details.map(safeText),
    why: (answer.why ?? []).map(safeText),
    materialLimits: (answer.materialLimits ?? []).map(safeText),
    understanding: answer.understanding ? {
      ...answer.understanding,
      summary: safeText(answer.understanding.summary),
      clarification: answer.understanding.clarification === null ? null : safeText(answer.understanding.clarification),
      boundary: answer.understanding.boundary === null ? null : safeText(answer.understanding.boundary),
    } : undefined,
    plan: answer.plan ? {
      ...answer.plan,
      clarification: answer.plan.clarification === null ? null : safeText(answer.plan.clarification),
      requestedEvidenceDomains: answer.plan.requestedEvidenceDomains.slice(0, 16),
    } : undefined,
    actionProposal: answer.actionProposal ? {
      ...answer.actionProposal,
      summary: safeText(answer.actionProposal.summary),
      target: safeText(answer.actionProposal.target),
      scope: contentMinimalScope(answer.actionProposal.scope),
      permissions: answer.actionProposal.permissions.map(safeText).slice(0, 8),
      allowedReadTools: answer.actionProposal.allowedReadTools.slice(0, 8),
    } : undefined,
    claims,
    synthesis,
    presentation: safePresentation(answer.presentation),
  }
}

/** Explicitly allowlisted model-facing evidence projection. */
export function contentMinimalEvidence(evidence: AdvisorEvidence, options: { preserveEvidenceIds?: boolean } = {}): AdvisorJsonObject {
  const spend = evidence.spend
    ? {
        measuredCostUSD: evidence.spend.measuredCostUSD,
        calls: evidence.spend.calls,
        sessions: evidence.spend.sessions,
        inputTokens: evidence.spend.inputTokens ?? null,
        outputTokens: evidence.spend.outputTokens ?? null,
        cacheReadTokens: evidence.spend.cacheReadTokens ?? null,
        cacheWriteTokens: evidence.spend.cacheWriteTokens ?? null,
        pricingCoverage: evidence.spend.pricingCoverage,
        models: evidence.spend.models.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        projects: evidence.spend.projects.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        sessionsByCost: evidence.spend.sessionsByCost.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        trend: evidence.spend.trend
          ? {
              direction: evidence.spend.trend.direction,
              latestCostUSD: evidence.spend.trend.latestCostUSD,
              comparisonCostUSD: evidence.spend.trend.comparisonCostUSD,
              deltaUSD: evidence.spend.trend.deltaUSD,
              deltaPercent: evidence.spend.trend.deltaPercent,
              latestDate: evidence.spend.trend.latestDate,
              comparisonLabel: sanitizeAdvisorDisplayText(evidence.spend.trend.comparisonLabel),
            }
            : null,
        history: evidence.spend.history.slice(-30).map(point => ({
          date: contentMinimalTimestamp(point.date) ?? sanitizeAdvisorDisplayText(point.date),
          costUSD: point.costUSD,
          calls: point.calls,
          inputTokens: point.inputTokens,
          outputTokens: point.outputTokens,
          cacheReadTokens: point.cacheReadTokens,
          cacheWriteTokens: point.cacheWriteTokens,
        })),
        modelHistory: evidence.spend.modelHistory.slice(0, 8).map(series => ({
          model: sanitizeAdvisorDisplayText(series.model),
          points: series.points.slice(-30).map(point => ({ date: sanitizeAdvisorDisplayText(point.date), costUSD: point.costUSD, calls: point.calls })),
        })),
      }
    : null
  const modelEfficiency = evidence.modelEfficiency
    ? {
        selectedModel: evidence.modelEfficiency.selectedModel === null ? null : sanitizeAdvisorDisplayText(evidence.modelEfficiency.selectedModel),
        comparableWorkWarning: evidence.modelEfficiency.comparableWorkWarning,
        rows: evidence.modelEfficiency.rows.map(row => ({
          model: sanitizeAdvisorDisplayText(row.model),
          provider: contentMinimalProvider(row.provider) ?? '[provider]',
          calls: row.calls,
          costUSD: row.costUSD,
          inputTokens: row.inputTokens ?? null,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens ?? null,
          cacheReadTokens: row.cacheReadTokens ?? null,
          cacheWriteTokens: row.cacheWriteTokens ?? null,
          reasoningTokens: row.reasoningTokens ?? null,
          additiveReasoningTokens: row.additiveReasoningTokens ?? null,
          costPerCallUSD: row.costPerCallUSD,
          pricingState: row.pricingState,
        })),
      }
    : null
  const quota = evidence.quota
    ? {
        measuredSpendUSD: evidence.quota.measuredSpendUSD,
        measuredCalls: evidence.quota.measuredCalls,
        providers: evidence.quota.providers.filter(provider => contentMinimalProvider(provider.provider) !== null).map(provider => ({
          provider: contentMinimalProvider(provider.provider)!,
          planLabel: provider.planLabel === null ? null : sanitizeAdvisorDisplayText(provider.planLabel),
          availability: provider.availability,
          connection: provider.connection,
          freshness: provider.freshness,
          observedAt: contentMinimalTimestamp(provider.observedAt),
          windows: provider.windows.map(window => ({
            label: sanitizeAdvisorDisplayText(window.label),
            usedPercent: window.usedPercent,
            remainingPercent: window.remainingPercent,
            resetsAt: contentMinimalTimestamp(window.resetsAt),
          })),
          creditsUSD: provider.creditsUSD,
        })),
      }
    : null
  const bench = evidence.bench
    ? {
        state: evidence.bench.state,
        latest: evidence.bench.latest === null ? null : contentMinimalBenchRun(evidence.bench.latest),
        runs: evidence.bench.runs.slice(0, 10).map(contentMinimalBenchRun),
        comparison: evidence.bench.comparison === null ? null : { ...evidence.bench.comparison, comparedRunIds: evidence.bench.comparison.comparedRunIds.map(value => safeBenchIdentifier(value)) },
      }
    : null
  return {
    intent: evidence.intent,
    scope: contentMinimalScope(evidence.scope),
    coverage: contentMinimalCoverage(evidence.coverage),
    refs: contentMinimalEvidenceRefs(evidence.refs, { preserveIds: options.preserveEvidenceIds }),
    spend,
    modelEfficiency,
    quota,
    bench,
    assumptions: evidence.assumptions.map(value => sanitizeAdvisorDisplayText(value)),
    unknown: evidence.unknown.map(value => sanitizeAdvisorDisplayText(value)),
    nextInvestigations: evidence.nextInvestigations.map(value => sanitizeAdvisorDisplayText(value)),
    domainCoverage: (evidence.domainCoverage ?? []).map(item => ({
      domain: item.domain,
      state: item.state,
      detail: sanitizeAdvisorDisplayText(item.detail),
      evidenceRefs: contentMinimalEvidenceRefs(item.evidenceRefs),
    })),
  }
}
