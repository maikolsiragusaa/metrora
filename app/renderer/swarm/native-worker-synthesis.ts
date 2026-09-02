import type { AdvisorModelRuntime, AdvisorScope } from '../advisor/types'
import { boundedSwarmText, sanitizeSwarmText } from '../../../src/swarm/evidence-v1'
import type {
  SwarmEvidenceResultStatusV1,
  SwarmSynthesisInputV1,
  SwarmSynthesisResultV1,
} from '../../../src/swarm/contract-v1'
import { isCancellation, safeRefs, safeToolName, throwIfAborted } from './native-worker-support'

function synthesisEvidenceStatus(worker: SwarmSynthesisInputV1['workers'][number]): SwarmEvidenceResultStatusV1 {
  if (worker.evidenceResult?.status === 'usable' || worker.evidenceResult?.status === 'partial' || worker.evidenceResult?.status === 'unavailable') {
    if (worker.evidenceResult.status !== 'unavailable' && worker.evidenceResult.requiredToolNames.length > 0 && worker.evidenceRefs.length === 0) return 'unavailable'
    return worker.evidenceResult.status
  }
  return worker.evidenceRefs.length ? 'usable' : 'unavailable'
}

function synthesisReports(input: SwarmSynthesisInputV1): Array<{
  role: string
  status: string
  answer: string
  evidenceSummary: string
  evidenceStatus: SwarmEvidenceResultStatusV1
  evidenceRefs: Array<{ id: string; label: string }>
  requiredToolNames: string[]
  toolNamesUsed: string[]
}> {
  return input.workers.slice(0, 3).map(worker => ({
    role: sanitizeSwarmText(worker.role, 64),
    status: sanitizeSwarmText(worker.status, 32),
    answer: boundedSwarmText(worker.answer, 4 * 1024),
    evidenceSummary: boundedSwarmText(worker.evidenceSummary, 1 * 1024),
    evidenceStatus: synthesisEvidenceStatus(worker),
    evidenceRefs: safeRefs(worker.evidenceRefs).slice(0, 16),
    requiredToolNames: worker.evidenceResult?.requiredToolNames?.slice(0, 16).map(name => safeToolName(name)) ?? [],
    toolNamesUsed: worker.evidenceResult?.usedToolNames?.slice(0, 16).map(name => safeToolName(name)) ?? worker.toolActivity.filter(item => item.status === 'completed').map(item => safeToolName(item.name)).slice(0, 16),
  }))
}

function synthesisNumbers(value: string): Set<string> {
  const numbers = new Set<string>()
  for (const token of value.match(/\d+(?:[.,]\d+)*(?:[kKmMbB])?/gu) ?? []) {
    const suffix = /[kKmMbB]$/u.test(token) ? token.slice(-1).toLowerCase() : ''
    const raw = suffix ? token.slice(0, -1) : token
    const lastComma = token.lastIndexOf(',')
    const lastDot = raw.lastIndexOf('.')
    let normalized = raw
    if (lastComma >= 0 && lastDot >= 0) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.'
      const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
      normalized = raw.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.')
    } else if (lastComma >= 0 && /,\d{3}(?:,\d{3})*$/u.test(raw)) {
      normalized = raw.replaceAll(',', '')
    } else {
      normalized = raw.replace(',', '.')
    }
    const parsed = Number(normalized)
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1
    if (Number.isFinite(parsed)) numbers.add(String(parsed * multiplier))
  }
  return numbers
}

const SYNTHESIS_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'being', 'could', 'data', 'does', 'evidence', 'from', 'have', 'into', 'just', 'more', 'only', 'that', 'the', 'this', 'using', 'with', 'your',
  'della', 'delle', 'degli', 'del', 'e', 'hai', 'ho', 'il', 'la', 'le', 'nei', 'nel', 'per', 'sono', 'una', 'un', 'che', 'piu',
])
const SYNTHESIS_ALIASES: Readonly<Record<string, string>> = {
  spend: 'spend', spent: 'spend', spending: 'spend', cost: 'spend', costs: 'spend', expense: 'spend', expenses: 'spend', spesa: 'spend', spese: 'spend', speso: 'spend', spesi: 'spend',
  measured: 'measured', measure: 'measured', measuredly: 'measured', osservato: 'measured', osservata: 'measured', misurato: 'measured', misurata: 'measured',
  total: 'total', totals: 'total', totally: 'total', overall: 'total', lifetime: 'lifetime', 'all-time': 'lifetime', totale: 'total', complessiva: 'total', complessivo: 'total',
  usage: 'usage', utilizzo: 'usage', consumi: 'usage', consumption: 'usage', calls: 'calls', call: 'calls', chiamate: 'calls', chiamata: 'calls',
  session: 'sessions', sessions: 'sessions', sessioni: 'sessions', model: 'models', models: 'models', modello: 'models', modelli: 'models',
  project: 'projects', projects: 'projects', progetto: 'projects', progetti: 'projects', provider: 'providers', providers: 'providers', fornitore: 'providers', fornitori: 'providers',
  quota: 'quota', capacity: 'quota', remaining: 'quota', reset: 'quota', soglia: 'threshold', threshold: 'threshold', exceeded: 'threshold', superata: 'threshold', superato: 'threshold',
  significant: 'interpretation', importante: 'interpretation', cifra: 'interpretation', meaningful: 'interpretation', verified: 'verified', verifiedly: 'verified', verifica: 'verified',
}

function synthesisSemanticWords(value: string): Set<string> {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase()
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []
  return new Set(words
    .filter(word => word.length >= 3 && !SYNTHESIS_STOP_WORDS.has(word))
    .map(word => SYNTHESIS_ALIASES[word] ?? word))
}

function synthesisEvidenceText(reports: ReturnType<typeof synthesisReports>): string {
  return reports.flatMap(report => [report.answer, report.evidenceSummary, ...report.evidenceRefs.map(ref => ref.id + ' ' + ref.label)]).join(' ')
}

function hasUnsupportedSubject(answer: string, evidence: string): boolean {
  const safeEvidence = evidence.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase()
  const generic = new Set(['selected', 'current', 'requested', 'the', 'a', 'an', 'il', 'la', 'i', 'le', 'un', 'una', 'usage', 'cost', 'spend', 'quality', 'total', 'calls', 'sessions', 'projects', 'models', 'providers', 'context', 'comparison', 'answer', 'scope', 'period'])
  for (const match of answer.matchAll(/\b(?:model|models|project|projects|session|sessions|provider|providers|service)\s+([A-Za-z0-9][A-Za-z0-9._:/-]*)/giu)) {
    const subject = (match[1] ?? '').toLocaleLowerCase()
    if (!subject || generic.has(subject)) continue
    if (!safeEvidence.includes(subject)) return true
  }
  return false
}

function sentenceParts(value: string): string[] {
  return value.split(/\r?\n+/u)
    .flatMap(line => line.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"'])/u))
    .flatMap(sentence => sentence.split(/\s+(?:but|however|ma|però|tuttavia)\s+/iu))
    .flatMap(sentence => sentence.split(/;\s*/u))
    .map(sentence => sentence.trim())
    .filter(Boolean)
}

function derivedNumbers(values: ReadonlySet<string>): Set<string> {
  const result = new Set(values)
  const parsed = [...values].map(Number).filter(Number.isFinite)
  for (const left of parsed) for (const right of parsed) if (left !== right) result.add(String(Math.abs(left - right)))
  return result
}

function interpretationClaim(value: string): boolean {
  return /\b(?:significant|meaningful|material|recommend|suggest|inspect|review|investigat|worth\s+(?:checking|inspecting)|importante|rilevante|consiglio|controllerei|ispezionerei)\w*/iu.test(value)
}

function sanitizeSynthesis(answer: string, input: SwarmSynthesisInputV1, reports: ReturnType<typeof synthesisReports>): { text: string; removed: number; diagnostics: string[] } {
  const text = boundedSwarmText(answer).trim()
  const task = boundedSwarmText(input.task).trim()
  if (!task || !text) return { text: '', removed: 0, diagnostics: ['ungrounded_narrative'] }
  const useful = reports.filter(report => report.evidenceStatus !== 'unavailable' && report.answer.trim() && (report.evidenceRefs.length > 0 || report.requiredToolNames.length === 0))
  if (!useful.length) return { text: '', removed: 0, diagnostics: ['ungrounded_narrative'] }
  const evidenceText = synthesisEvidenceText(useful)
  const evidenceWords = synthesisSemanticWords(evidenceText)
  const taskWords = synthesisSemanticWords(task)
  const allowedNumbers = derivedNumbers(new Set([...synthesisNumbers(evidenceText), ...synthesisNumbers(task)]))
  const factualAnswerWords = new Set(['spend', 'measured', 'total', 'lifetime', 'usage', 'calls', 'sessions', 'models', 'projects', 'providers', 'quota', 'threshold', 'verified', 'interpretation'])
  const canonicalReadRequired = reports.some(report => report.requiredToolNames.length > 0)
  const limitedEvidence = reports.some(report => report.requiredToolNames.length > 0 && report.evidenceStatus !== 'usable')
  const accepted: string[] = []
  const diagnostics: string[] = []
  for (const clause of sentenceParts(text)) {
    const answerWords = synthesisSemanticWords(clause)
    const answerNumbers = synthesisNumbers(clause)
    const sharedEvidenceWords = [...answerWords].filter(word => evidenceWords.has(word))
    const sharedTaskWords = [...answerWords].filter(word => taskWords.has(word))
    if ([...answerNumbers].some(number => !allowedNumbers.has(number))) {
      diagnostics.push('unsupported_numeric_claim')
      continue
    }
    if (hasUnsupportedSubject(clause, evidenceText)) {
      diagnostics.push('unsupported_subject_claim')
      continue
    }
    if (/\b(?:caused?|causes?|due\s+to|because\s+of|reason\s+(?:is|was)|responsible\s+for|a\s+causa\s+di|ha\s+causato)\b/iu.test(clause)) {
      diagnostics.push('unsupported_causality')
      continue
    }
    if (/\b(?:hello|hi|hey|good\s+morning|good\s+evening|i\s+can\s+help|what\s+would\s+you\s+like|how\s+can\s+i\s+help)\b/iu.test(clause)) {
      diagnostics.push('ungrounded_narrative')
      continue
    }
    if (canonicalReadRequired && !sharedEvidenceWords.length && !sharedTaskWords.length && !interpretationClaim(clause)) {
      diagnostics.push('ungrounded_narrative')
      continue
    }
    if (canonicalReadRequired && !answerWordsHasFactualAnchor(answerWords) && !interpretationClaim(clause)) {
      diagnostics.push('ungrounded_narrative')
      continue
    }
    const stateDisclosure = /\b(?:partial|parziale|unavailable|non\s+disponibile|insufficient|insufficiente|missing|mancante|failed|fallito|failure|timeout|timed\s+out|scaduto|not\s+available|could\s+not|cannot|impossibile)\b/iu.test(clause)
    if (limitedEvidence && !stateDisclosure) {
      diagnostics.push('unsupported_factual_claim')
      continue
    }
    if (limitedEvidence && /\b(?:high\s+coverage|fully\s+verified|all\s+evidence\s+is\s+available|conclusive|alta\s+copertura|completamente\s+verificato|conclusivo)\b/iu.test(clause)) {
      diagnostics.push('unsupported_factual_claim')
      continue
    }
    accepted.push(clause)
  }
  return { text: accepted.join(' ').trim(), removed: Math.max(0, sentenceParts(text).length - accepted.length), diagnostics: [...new Set(diagnostics)] }
}

function answerWordsHasFactualAnchor(words: ReadonlySet<string>): boolean {
  return [...words].some(word => ['spend', 'measured', 'total', 'lifetime', 'usage', 'calls', 'sessions', 'models', 'projects', 'providers', 'quota', 'threshold', 'verified', 'interpretation'].includes(word))
}

function deterministicWorkerCloseout(input: SwarmSynthesisInputV1, reports: ReturnType<typeof synthesisReports>, extraError?: string): SwarmSynthesisResultV1 {
  const useful = reports.filter(report => report.evidenceStatus !== 'unavailable' && (report.evidenceRefs.length > 0 || report.requiredToolNames.length === 0) && report.answer.trim())
  const unavailable = reports.filter(report => report.evidenceStatus === 'unavailable' || (report.requiredToolNames.length > 0 && !report.evidenceRefs.length))
  const partial = reports.filter(report => report.evidenceStatus === 'partial')
  const answer = useful.length
    ? 'For the original task, the bounded independent Metrora worker findings are:\n\n' + useful.map(report => report.answer).join('\n\n')
    : 'No canonical Metrora evidence was available, so no factual conclusion can be made for the original task.'
  const status: SwarmSynthesisResultV1['status'] = useful.length ? 'completed' : 'unavailable'
  const summary = [
    useful.length + ' worker closeout(s) contained usable canonical evidence.',
    partial.length ? partial.length + ' closeout(s) were partial.' : '',
    unavailable.length ? unavailable.length + ' closeout(s) had unavailable evidence.' : '',
  ].filter(Boolean).join(' ')
  return {
    status,
    answer: boundedSwarmText(answer),
    evidenceSummary: boundedSwarmText(summary),
    errors: extraError ? [boundedSwarmText(extraError, 400)] : [],
  }
}

export function createNativeHarnessSwarmSynthesizer(runtime: AdvisorModelRuntime, now: () => string = () => new Date().toISOString()): (input: SwarmSynthesisInputV1, signal: AbortSignal) => Promise<SwarmSynthesisResultV1> {
  return async (input, signal) => {
    void now
    throwIfAborted(signal)
    const reports = synthesisReports(input)
    if (runtime.mode === 'unsupported' || runtime.mode === 'deterministic-local' || runtime.availability === 'unavailable' || !runtime.generateSwarmSynthesis) {
      return deterministicWorkerCloseout(input, reports, 'Dedicated Swarm synthesis was unavailable; deterministic worker closeout was used.')
    }
    try {
      // This is a dedicated runtime boundary. It receives the original task
      // and normalized terminal reports, never a synthetic Harness question,
      // so it cannot re-enter ordinary social/question classification.
      const generated = await runtime.generateSwarmSynthesis({ question: input.task, scope: input.scope as unknown as AdvisorScope, workers: reports }, signal)
      throwIfAborted(signal)
      const sanitized = sanitizeSynthesis(generated.answer, input, reports)
      if (!sanitized.text) return deterministicWorkerCloseout(input, reports, 'Dedicated Swarm synthesis contained no safe supported explanation; worker closeout was used.')
      return {
        status: 'completed',
        answer: boundedSwarmText(sanitizeSwarmText(sanitized.text)),
        evidenceSummary: boundedSwarmText([generated.evidenceSummary, reports.map(report => report.evidenceStatus + ' evidence via ' + report.evidenceRefs.map(ref => ref.label).join('; ')).join(' | ')].filter(Boolean).join(' ')),
        errors: sanitized.removed ? ['Some synthesis claims were omitted because worker evidence did not support them.'] : [],
      }
    } catch (error) {
      if (isCancellation(error, signal)) throw error
      return deterministicWorkerCloseout(input, reports, 'Dedicated Swarm synthesis failed; deterministic worker closeout was used.')
    }
  }
}
