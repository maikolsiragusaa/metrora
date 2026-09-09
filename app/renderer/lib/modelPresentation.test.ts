import { describe, expect, it } from 'vitest'

import {
  modelHouseIdFromName,
  modelHouseLabel,
  modelHouseLogoKey,
  modelHouseValues,
  normalizeModelHouseId,
} from './modelPresentation'

describe('model-house presentation', () => {
  it('recognizes reviewed model families independently of their delivery route', () => {
    expect(modelHouseIdFromName('GLM-5.3 Flash')).toBe('zai')
    expect(modelHouseValues({ name: 'vendor-neutral-model', brandId: 'openai', rawModels: ['provider/model'] })).toEqual(['openai'])
    expect(modelHouseValues({ name: 'Claude 4', brandId: undefined, rawModels: ['claude-4-sonnet'] })).toEqual(['anthropic'])
  })

  it('normalizes labels and keeps an explicit fallback for unknown houses', () => {
    expect(normalizeModelHouseId('z.ai')).toBe('zai')
    expect(modelHouseLabel('zai')).toBe('Z.ai')
    expect(modelHouseLogoKey('openai')).toBe('codex')
    expect(modelHouseValues({ name: 'vendor-neutral-model', brandId: undefined, rawModels: ['provider/model'] })).toEqual(['unresolved'])
  })
})
