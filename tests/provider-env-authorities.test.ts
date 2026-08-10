import { afterEach, describe, expect, it } from 'vitest'

import {
  COPILOT_DEFERRED_ENV_FINGERPRINTS,
  PROVIDER_ENV_FINGERPRINT_ADDITIONS,
  ensureProviderEnvFingerprintAuthorities,
  getProviderEnvConfigHash,
} from '../src/provider-parse-authorities.js'
import { PROVIDER_ENV_VARS } from '../src/session-cache.js'

const saved = new Map<string, string | undefined>()

function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  saved.clear()
})

describe('provider env cache authorities', () => {
  it('installs every reviewed Metrora env declaration idempotently', () => {
    ensureProviderEnvFingerprintAuthorities()
    const once = JSON.stringify(PROVIDER_ENV_VARS)
    ensureProviderEnvFingerprintAuthorities()
    expect(JSON.stringify(PROVIDER_ENV_VARS)).toBe(once)

    for (const [provider, additions] of Object.entries(PROVIDER_ENV_FINGERPRINT_ADDITIONS)) {
      for (const name of additions) {
        expect(PROVIDER_ENV_VARS[provider]).toContain(name)
      }
    }
  })

  it('does not provider-wide fingerprint Copilot until durable present-path history can merge safely', () => {
    ensureProviderEnvFingerprintAuthorities()
    const declared = PROVIDER_ENV_VARS['copilot'] ?? []
    for (const name of COPILOT_DEFERRED_ENV_FINGERPRINTS) {
      expect(declared).not.toContain(name)
    }
  })

  it('changes the daily authority when a declared source/profile override changes without exposing the value', () => {
    setEnv('GROK_HOME', '/tmp/metrora-grok-a')
    const first = getProviderEnvConfigHash()
    setEnv('GROK_HOME', '/tmp/metrora-grok-b')
    const second = getProviderEnvConfigHash()

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f]{24}$/)
    expect(second).toMatch(/^[0-9a-f]{24}$/)
    expect(first).not.toContain('/tmp/metrora-grok-a')
    expect(second).not.toContain('/tmp/metrora-grok-b')
  })

  it('hashes Vercel credential identity without serializing the credential', () => {
    const secret = 'metrora-test-secret-never-persist-this-value'
    setEnv('AI_GATEWAY_API_KEY', secret)
    const withSecret = getProviderEnvConfigHash()
    setEnv('AI_GATEWAY_API_KEY', 'different-test-secret')
    const rotated = getProviderEnvConfigHash()

    expect(withSecret).not.toBe(rotated)
    expect(withSecret).not.toContain(secret)
  })
})
