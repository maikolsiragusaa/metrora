// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultEnabledFor, sanitizeProps, TELEMETRY_ENDPOINT, Telemetry } from './telemetry'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'metrora-telemetry-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function make() {
  const fetchFn = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch
  const telemetry = new Telemetry({
    stateDir: dir,
    country: 'US',
    isPackaged: true,
    appVersion: '1.0.0',
    fetchFn,
  })
  return { telemetry, fetchFn }
}

describe('Metrora telemetry boundary', () => {
  it('has no network endpoint and defaults off in every region', () => {
    expect(TELEMETRY_ENDPOINT).toBeNull()
    for (const country of ['IT', 'US', 'JP', null, undefined]) {
      expect(defaultEnabledFor(country)).toBe(false)
    }
  })

  it('reports an immutable disabled, already-onboarded state', () => {
    const { telemetry } = make()
    expect(telemetry.status()).toEqual({
      installId: 'disabled',
      country: 'US',
      enabled: false,
      defaultEnabled: false,
      onboarded: true,
    })
    expect(telemetry.setEnabled(true).enabled).toBe(false)
    expect(telemetry.completeOnboarding(true).enabled).toBe(false)
  })

  it('never queues or sends events', async () => {
    const { telemetry, fetchFn } = make()
    telemetry.track('app_open', {})
    telemetry.track('usage_snapshot', { costBucket: '1-10' })
    telemetry.trackClose()

    expect(telemetry.queueLength).toBe(0)
    expect(await telemetry.flush()).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('removes an inherited telemetry identifier file', () => {
    const stateFile = join(dir, 'telemetry.v1.json')
    writeFileSync(stateFile, JSON.stringify({ installId: 'legacy-id', enabled: true }))
    expect(existsSync(stateFile)).toBe(true)

    make()
    expect(existsSync(stateFile)).toBe(false)
  })

  it('keeps the compatibility sanitizer local and primitive-only', () => {
    expect(sanitizeProps({
      text: 'x'.repeat(100),
      finite: 4,
      enabled: true,
      nested: { secret: 'drop' },
      invalid: Number.NaN,
    })).toEqual({ text: 'x'.repeat(64), finite: 4, enabled: true })
  })
})
