import { readStorage, removeStorage, writeStorage } from './storage'

/**
 * The first-run experience is a local product state, not a telemetry or
 * consent state. Bumping this value intentionally introduces a new onboarding
 * version while completed older versions remain explicit and inspectable.
 */
export const ONBOARDING_VERSION = 1
export const ONBOARDING_VERSION_STORAGE_KEY = 'onboarding.version'

function parseVersion(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function readOnboardingVersion(): number | null {
  return parseVersion(readStorage(ONBOARDING_VERSION_STORAGE_KEY))
}

export function shouldShowOnboarding(): boolean {
  return readOnboardingVersion() !== ONBOARDING_VERSION
}

export function completeOnboarding(): void {
  writeStorage(ONBOARDING_VERSION_STORAGE_KEY, String(ONBOARDING_VERSION))
}

/** Developer/test reset path. It deliberately touches only onboarding state. */
export function resetOnboarding(): void {
  removeStorage(ONBOARDING_VERSION_STORAGE_KEY)
}
