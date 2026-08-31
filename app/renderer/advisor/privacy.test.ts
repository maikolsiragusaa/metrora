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
  ])('rejects known internal output classes without censoring ordinary prose: %s', value => {
    expect(containsAdvisorForbiddenOutputClass(value)).toBe(true)
    expect(sanitizeAdvisorModelOutput(value)).toBe('')
    expect(sanitizeAdvisorNarrative(value)).toBe('')
  })

  it('keeps benign system language and verified numeric display text available', () => {
    expect(containsAdvisorForbiddenOutputClass('The local system is healthy.')).toBe(false)
    expect(sanitizeAdvisorModelOutput('The local system is healthy.')).toBe('The local system is healthy.')
    expect(sanitizeAdvisorDisplayText('Metrora measured 12 USD.')).toBe('Metrora measured 12 USD.')
  })

  it('allows bounded interpretation but rejects unsupported causal attribution', () => {
    expect(sanitizeAdvisorNarrative('This is worth comparing with your own budget or history.')).toContain('worth comparing')
    expect(sanitizeAdvisorNarrative('The spend increase was caused by one project.')).toBe('')
    expect(sanitizeAdvisorNarrative('The main driver is the selected model.')).toBe('')
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

