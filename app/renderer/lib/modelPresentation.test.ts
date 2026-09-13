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

  it('maps Cursor, NVIDIA, Xiaomi, Poolside, and Meta Muse models from their names', () => {
    expect(modelHouseIdFromName('Composer 2.5')).toBe('cursor')
    expect(modelHouseIdFromName('Cursor (auto)')).toBe('cursor')
    expect(modelHouseLabel('cursor')).toBe('Cursor')
    expect(modelHouseLogoKey('cursor')).toBe('cursor')
    expect(normalizeModelHouseId('anysphere')).toBe('cursor')
    expect(modelHouseIdFromName('nemotron-3-ultra-free')).toBe('nvidia')
    expect(modelHouseIdFromName('MiMo v2.5 free')).toBe('xiaomi')
    expect(modelHouseIdFromName('muse-spark-1.3-contributor-free')).toBe('meta')
    expect(modelHouseIdFromName('Laguna S 2.1 free')).toBe('poolside')
    expect(modelHouseLabel('poolside')).toBe('Poolside')
    expect(modelHouseLabel('nvidia')).toBe('NVIDIA')
    expect(modelHouseLabel('xiaomi')).toBe('Xiaomi')
  })
})
