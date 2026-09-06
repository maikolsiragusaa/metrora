// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  completeOnboarding,
  ONBOARDING_VERSION,
  readOnboardingVersion,
  resetOnboarding,
  shouldShowOnboarding,
} from './onboardingState'

describe('versioned local onboarding state', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows onboarding when no version has completed', () => {
    expect(readOnboardingVersion()).toBeNull()
    expect(shouldShowOnboarding()).toBe(true)
  })

  it('persists the current version locally and suppresses replay after restart', () => {
    completeOnboarding()

    expect(localStorage.getItem('metrora.onboarding.version')).toBe(String(ONBOARDING_VERSION))
    expect(readOnboardingVersion()).toBe(ONBOARDING_VERSION)
    expect(shouldShowOnboarding()).toBe(false)
  })

  it('replays intentionally when a different version is stored', () => {
    localStorage.setItem('metrora.onboarding.version', '2')

    expect(readOnboardingVersion()).toBe(2)
    expect(shouldShowOnboarding()).toBe(true)
  })

  it('ignores malformed state and exposes an isolated reset path', () => {
    localStorage.setItem('metrora.onboarding.version', '{"completed":true}')
    expect(readOnboardingVersion()).toBeNull()
    completeOnboarding()
    localStorage.setItem('metrora.telemetry.enabled', 'true')

    resetOnboarding()

    expect(localStorage.getItem('metrora.onboarding.version')).toBeNull()
    expect(localStorage.getItem('metrora.telemetry.enabled')).toBe('true')
  })
})
