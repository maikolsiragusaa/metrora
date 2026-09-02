import { describe, expect, it } from 'vitest'

import {
  HARNESS_RUNTIME_PROFILE_STORAGE_KEY,
  hostedConsentKey,
  loadHarnessRuntimeProfile,
  runtimeReasoningKey,
  saveHarnessRuntimeProfile,
  type HarnessRuntimeProfile,
} from './runtime-profile'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
    clear: () => { values.clear() },
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  } as Storage
}

describe('Harness runtime profile', () => {
  it('round-trips hosted and local selections without storing credentials', () => {
    const surface = storage()
    const hostedKey = runtimeReasoningKey('hosted', 'openrouter', 'openai/mimo-v2.5-free', 'ollama', null)
    const localKey = runtimeReasoningKey('llama-server', 'openrouter', null, 'llama-server', 'qwen2.5')
    const profileWithUnknown = {
      schemaVersion: 1,
      runtimeChoice: 'hosted',
      localRuntime: 'llama-server',
      hostedProvider: 'openrouter',
      hostedModels: { openrouter: 'openai/mimo-v2.5-free' },
      localModels: { 'llama-server': 'qwen2.5' },
      llamaServerPort: 9123,
      reasoningEfforts: { [hostedKey]: 'high', [localKey]: 'default' },
      hostedConsent: { [hostedConsentKey('openrouter', 'openai/mimo-v2.5-free')]: true },
      apiKey: 'must-not-be-persisted',
    } as HarnessRuntimeProfile & { apiKey: string }
    saveHarnessRuntimeProfile(profileWithUnknown, surface)

    const restored = loadHarnessRuntimeProfile(surface)
    expect(restored.runtimeChoice).toBe('hosted')
    expect(restored.hostedProvider).toBe('openrouter')
    expect(restored.hostedModels.openrouter).toBe('openai/mimo-v2.5-free')
    expect(restored.localRuntime).toBe('llama-server')
    expect(restored.localModels['llama-server']).toBe('qwen2.5')
    expect(restored.llamaServerPort).toBe(9123)
    expect(restored.reasoningEfforts[hostedKey]).toBe('high')
    expect(restored.hostedConsent[hostedConsentKey('openrouter', 'openai/mimo-v2.5-free')]).toBe(true)
    expect(surface.getItem(HARNESS_RUNTIME_PROFILE_STORAGE_KEY)).not.toContain('must-not-be-persisted')
  })

  it('drops malformed or unbounded preference values and keeps the legacy port migration bounded', () => {
    const surface = storage()
    surface.setItem('metrora.llama-server.port', '9876')
    expect(loadHarnessRuntimeProfile(surface).llamaServerPort).toBe(9876)

    surface.setItem('metrora.harness.runtime-profile.v1', JSON.stringify({
      schemaVersion: 99,
      runtimeChoice: 'remote-shell',
      localRuntime: 'llama-server',
      hostedProvider: 'openrouter',
      hostedModels: { openrouter: 'valid/model', bad: 'x' },
      localModels: { 'llama-server': 'valid-model' },
      llamaServerPort: 70000,
      reasoningEfforts: { 'hosted:openrouter:valid/model': 'ultra' },
      hostedConsent: { 'openrouter:valid/model': true },
    }))

    const restored = loadHarnessRuntimeProfile(surface)
    expect(restored.runtimeChoice).toBe('ollama')
    expect(restored.localRuntime).toBe('ollama')
    expect(restored.llamaServerPort).toBe(8080)
    expect(restored.reasoningEfforts).toEqual({})
    expect(restored.hostedModels).toEqual({})

    surface.setItem('metrora.harness.runtime-profile.v1', JSON.stringify({
      schemaVersion: 1,
      runtimeChoice: 'remote-shell',
      localRuntime: 'llama-server',
      hostedProvider: 'openrouter',
      hostedModels: { openrouter: 'valid/model', bad: 'x' },
      localModels: { 'llama-server': 'valid-model' },
      llamaServerPort: 70000,
      reasoningEfforts: { 'hosted:openrouter:valid/model': 'ultra' },
      hostedConsent: { 'openrouter:valid/model': true },
    }))
    const sanitized = loadHarnessRuntimeProfile(surface)
    expect(sanitized.runtimeChoice).toBe('ollama')
    expect(sanitized.localRuntime).toBe('llama-server')
    expect(sanitized.llamaServerPort).toBe(8080)
    expect(sanitized.reasoningEfforts).toEqual({})
    expect(sanitized.hostedModels.openrouter).toBe('valid/model')
  })
})
