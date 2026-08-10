import { afterEach, describe, expect, it } from 'vitest'

import { collectDoctorReport, renderDoctorJson, renderDoctorTable } from '../src/doctor.js'
import { ensureProviderEnvFingerprintAuthorities } from '../src/provider-parse-authorities.js'
import { emptyCache } from '../src/session-cache.js'
import type { Provider } from '../src/providers/types.js'

const saved = new Map<string, string | undefined>()

function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function fakeProvider(name: string, network = false): Provider {
  return {
    name,
    displayName: name,
    network,
    modelDisplayName: model => model,
    toolDisplayName: tool => tool,
    discoverSessions: async () => [],
    createSessionParser: () => ({ async *parse() {} }),
  }
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  saved.clear()
})

describe('doctor env authority safety', () => {
  it('redacts Vercel credential values from the report and both renderers', async () => {
    ensureProviderEnvFingerprintAuthorities()
    const secret = 'super-secret-doctor-fixture-value'
    setEnv('AI_GATEWAY_API_KEY', secret)

    const report = await collectDoctorReport('vercel-gateway', {
      providers: [fakeProvider('vercel-gateway', true)],
      cache: emptyCache(),
    })

    expect(report.providers[0]?.envOverrides).toContainEqual({
      name: 'AI_GATEWAY_API_KEY',
      value: '<set>',
    })
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(renderDoctorJson(report)).not.toContain(secret)
    expect(renderDoctorTable(report, { color: false })).not.toContain(secret)
  })

  it('fingerprints APPDATA without presenting it as a deliberate override', async () => {
    ensureProviderEnvFingerprintAuthorities()
    setEnv('APPDATA', 'C:\\Users\\fixture\\AppData\\Roaming')

    const report = await collectDoctorReport('claude', {
      providers: [fakeProvider('claude')],
      cache: emptyCache(),
    })
    expect(report.providers[0]?.envOverrides.some(item => item.name === 'APPDATA')).toBe(false)
  })

  it('does not blame parse-only Cursor settings for empty discovery', async () => {
    ensureProviderEnvFingerprintAuthorities()
    setEnv('METRORA_CURSOR_MAX_BUBBLES', '50')

    const report = await collectDoctorReport('cursor', {
      providers: [fakeProvider('cursor')],
      cache: emptyCache(),
    })
    const row = report.providers[0]!
    expect(row.envOverrides).toContainEqual({ name: 'METRORA_CURSOR_MAX_BUBBLES', value: '50' })
    expect(row.verdict).not.toContain('override METRORA_CURSOR_MAX_BUBBLES')
  })
})
