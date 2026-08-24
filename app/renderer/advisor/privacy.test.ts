import { describe, expect, it } from 'vitest'

import {
  containsAdvisorSensitiveText,
  sanitizeAdvisorDisplayText,
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

