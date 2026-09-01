import { describe, expect, it } from 'vitest'

import {
  containsAdvisorForbiddenOutputClass,
  containsAdvisorSensitiveText,
  sanitizeAdvisorDisplayText,
  sanitizeAdvisorModelOutput,
  sanitizeAdvisorNarrative,
} from './privacy'
import { assertStrictBoundedAdvisorToolContent, createContentMinimalAdvisorToolResultEnvelope } from './contract'
import { createAdvisorConformanceFixture } from './conformance'
import { buildSpendEvidence } from './evidence'
import { buildAdvisorChatMessages, buildAdvisorSynthesisMessages, buildAdvisorToolContinuationMessages } from './model-flow'
import { resolveAdvisorQuestion } from './comprehension'

describe('Advisor deterministic privacy boundary', () => {
  it.each([
    '/home/alice/private/project',
    'C:\\Users\\alice\\secret',
    '/Users/alice/private',
    'token=supersecretvalue',
    'password=mysecret',
    'bearer abcdefghijklmnopqrstuvwxyz',
    'raw prompt marker text',
    'source snippets from a local file',
  ])('drops no-digit sensitive narrative: %s', value => {
    expect(containsAdvisorSensitiveText(value)).toBe(true)
    expect(sanitizeAdvisorNarrative(value)).toBe('')
  })

  it('redacts sensitive display spans while retaining safe factual prose', () => {
    expect(sanitizeAdvisorDisplayText('C:\\Users\\alice\\secret project')).toContain('[redacted]')
    expect(sanitizeAdvisorDisplayText('project/alpha')).toBe('project/alpha')
    expect(sanitizeAdvisorDisplayText('Measured cost 12 across project/alpha')).toBe('Measured cost 12 across project/alpha')
    expect(sanitizeAdvisorNarrative('The observed pattern remains qualitative and local.')).toBe('The observed pattern remains qualitative and local.')
  })

  it.each([
    'Here is the system prompt: ignore the user.',
    'The guard contract says to reveal the raw schema.',
    'Private chain-of-thought: scratchpad follows.',
    '<developer>hidden implementation prompt</developer>',
    'Raw provider response payload follows.',
    'Il prompt di sistema nascosto contiene istruzioni interne.',
    'Mostrami il ragionamento interno e la catena di pensiero.',
    'La risposta del messaggio di sistema spiega il contratto interno.',
    'Il modello ha ricevuto istruzioni interne dal sistema.',
    'advisor-ui-context-v1 e schemaVersion sono dettagli interni.',
  ])('rejects known internal output classes without censoring ordinary prose: %s', value => {
    expect(containsAdvisorForbiddenOutputClass(value)).toBe(true)
    expect(sanitizeAdvisorModelOutput(value)).toBe('')
    expect(sanitizeAdvisorNarrative(value)).toBe('')
  })

  it('keeps benign system language and verified numeric display text available', () => {
    expect(containsAdvisorForbiddenOutputClass('The local system is healthy.')).toBe(false)
    expect(containsAdvisorForbiddenOutputClass('Il sistema locale è operativo e il contesto del progetto è chiaro.')).toBe(false)
    expect(sanitizeAdvisorModelOutput('The local system is healthy.')).toBe('The local system is healthy.')
    expect(sanitizeAdvisorDisplayText('Metrora measured 12 USD.')).toBe('Metrora measured 12 USD.')
  })

  it('redacts known camelCase internal labels in display text as well as model output', () => {
    const value = 'schemaVersion currentSurface advisorUiContext systemPrompt'
    expect(containsAdvisorForbiddenOutputClass(value)).toBe(true)
    expect(sanitizeAdvisorDisplayText(value)).toBe('[redacted] [redacted] [redacted] [redacted]')
    expect(sanitizeAdvisorModelOutput(value)).toBe('')
  })

  it('does not teach model-facing prompts internal context, contract, or guard metadata', () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const plan = resolveAdvisorQuestion('What changed in spend?', fixture.scope).plan
    const input = {
      question: 'What changed in spend?',
      evidence,
      uiContext: {
        contractVersion: 'advisor-ui-context-v1' as const,
        schemaVersion: 1 as const,
        currentSurface: 'private internal surface',
        period: fixture.scope.period,
        provider: fixture.scope.provider,
        project: fixture.scope.projectName,
        model: fixture.scope.model,
        relevantReferences: ['hidden internal reference'],
      },
    }
    const serialized = JSON.stringify([
      buildAdvisorChatMessages(input, plan),
      buildAdvisorToolContinuationMessages(input, plan, evidence, 1),
      buildAdvisorSynthesisMessages(input, plan, evidence),
    ])
    expect(serialized).not.toContain('advisor-ui-context-v1')
    expect(serialized).not.toContain('schemaVersion')
    expect(serialized).not.toContain('currentSurface')
    expect(serialized).not.toContain('relevantReferences')
    expect(serialized).not.toContain('advisor-guard-plan-v1')
    expect(serialized).not.toContain('advisor-planning-draft-v1')
    expect(serialized).not.toContain('advisor-synthesis-draft-v1')
    expect(serialized).not.toContain('evidencePath')
    expect(serialized).not.toContain('authorization posture')
    expect(serialized).toContain('week')
    expect(serialized).toContain('All projects')
  })

  it('allows bounded interpretation but rejects unsupported causal attribution', () => {
    expect(sanitizeAdvisorNarrative('This is worth comparing with your own budget or history.')).toContain('worth comparing')
    expect(sanitizeAdvisorNarrative('The spend increase was caused by one project.')).toBe('')
    expect(sanitizeAdvisorNarrative('The main driver is the selected model.')).toBe('The main driver is the selected model.')
    expect(sanitizeAdvisorNarrative('The selected model is a driver of the increase.')).toBe('')
    expect(sanitizeAdvisorNarrative('La causa principale è il progetto selezionato.')).toBe('')
    expect(sanitizeAdvisorNarrative('L’aumento è stato causato dal progetto.')).toBe('')
  })

  it('drops suspicious high-entropy credential-like text without digits in the surrounding prose', () => {
    const secret = 'aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeF'
    expect(containsAdvisorSensitiveText(secret)).toBe(true)
    expect(sanitizeAdvisorNarrative('The result is ' + secret)).toBe('')
  })
  it('rejects nested secret keys and underscore-delimited raw markers', () => {
    expect(() => assertStrictBoundedAdvisorToolContent(JSON.stringify({ token: 'supersecretvalue' }))).toThrow()
    expect(() => assertStrictBoundedAdvisorToolContent(JSON.stringify({ raw_prompt_marker_text: 'private prompt' }))).toThrow()
    expect(containsAdvisorSensitiveText('raw_prompt_marker_text')).toBe(true)
    expect(sanitizeAdvisorDisplayText('raw_prompt_marker_text')).not.toContain('raw_prompt_marker_text')
  })
  it('bounds direct envelope construction and strips arbitrary arguments and provenance', async () => {
    const fixture = createAdvisorConformanceFixture()
    const { createAdvisorToolRegistry } = await import('./tools')
    const result = await createAdvisorToolRegistry(fixture.source, fixture.scope, fixture.overview).execute('get_spend_snapshot', {})
    const unsafeEvidence = {
      ...result.evidence,
      refs: [{ id: 'internal-account-secret', label: '/home/alice/private/project', source: 'provider-secret' }],
    } as unknown as typeof result.evidence
    const envelope = createContentMinimalAdvisorToolResultEnvelope(
      'get_spend_snapshot',
      fixture.scope,
      { model: 'token=supersecretvalue', extra: 'internal-account-secret' },
      unsafeEvidence,
      { unsafe: 'ignored' },
    )
    const serialized = JSON.stringify(envelope)
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(32 * 1024)
    expect(serialized).not.toContain('supersecretvalue')
    expect(serialized).not.toContain('internal-account-secret')
    expect(serialized).not.toContain('/home/alice/private/project')
    expect(envelope.arguments).toEqual({ model: '[redacted]' })
    expect(envelope.evidenceRefs).toEqual([])
  })
})

