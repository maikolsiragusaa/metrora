// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import type { DurableModelPresentationRow, MenubarPayload, SessionRow } from '../lib/types'
import { buildUsageMixSlides } from './ControlCenterHome'

type HomeCurrent = MenubarPayload['current']

type PresentationRowFixture = Record<string, unknown> & { name: string }

function presentationRow(overrides: PresentationRowFixture) {
  return {
    cost: 1,
    savingsUSD: 0,
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokenDetail: true,
    presentationIdentity: `row:${overrides.name}`,
    providers: [],
    provider: '',
    sourceProviders: [],
    rawModels: [overrides.name],
    canonicalIdentities: [],
    economicVariants: [],
    reasoningSemantics: 'unavailable',
    timingCoverage: 'unavailable',
    deliveryRows: [],
    deliveryStatus: 'unavailable',
    ...overrides,
  } as unknown as DurableModelPresentationRow
}

function currentFixture(overrides: Partial<HomeCurrent> = {}): HomeCurrent {
  return {
    label: 'Lifetime · All providers',
    cost: 10,
    savingsUSD: 0,
    sessions: 3,
    calls: 40,
    models: 2,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    topModels: [
      { name: 'GPT-5.4', cost: 7, savingsUSD: 0, savingsBaselineModel: '', calls: 30, brandId: 'openai' },
      { name: 'GLM-5.3', cost: 3, savingsUSD: 0, savingsBaselineModel: '', calls: 10, brandId: 'zai' },
    ],
    localModelSavings: { totalUSD: 0 },
    providers: {},
    retryTax: { totalUSD: 0, retries: 0, byModel: [] },
    ...overrides,
  } as unknown as HomeCurrent
}

function session(overrides: Partial<SessionRow> & Pick<SessionRow, 'sessionId' | 'provider'>): SessionRow {
  return {
    title: '',
    project: 'p',
    models: ['m'],
    cost: 1,
    savingsUSD: 0,
    calls: 10,
    turns: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    startedAt: '2026-09-13T00:00:00.000Z',
    endedAt: '2026-09-13T01:00:00.000Z',
    durationMs: 60_000,
    ...overrides,
  }
}

describe('buildUsageMixSlides', () => {
  it('ranks the top model by total tokens and the top model by cost', () => {
    const current = currentFixture({
      modelPresentation: {
        rows: [
          presentationRow({ name: 'GPT-5.4', inputTokens: 100, outputTokens: 100, calls: 30 }),
          presentationRow({ name: 'GLM-5.3', inputTokens: 300, outputTokens: 300, calls: 10 }),
        ],
        accountingRowCount: 2,
      },
    } as Partial<HomeCurrent>)

    const slides = buildUsageMixSlides(current, undefined)
    expect(slides.map(slide => slide.id)).toEqual(['tokens', 'cost'])

    const tokenSlide = slides[0]!
    if (tokenSlide.kind !== 'models') throw new Error('expected a models slide')
    expect(tokenSlide.caption).toBe('Top models by total tokens')
    expect(tokenSlide.bars.map(bar => bar.name)).toEqual(['GLM-5.3', 'GPT-5.4'])
    expect(tokenSlide.bars[0]!.height).toBe(1)
    expect(tokenSlide.bars[0]!.value).toBe('600')
    expect(tokenSlide.bars[0]!.logo).toBe('zai')
    expect(tokenSlide.bars[1]!.height).toBeCloseTo(1 / 3)

    const costSlide = slides[1]!
    if (costSlide.kind !== 'models') throw new Error('expected a models slide')
    expect(costSlide.caption).toBe('Top models by cost')
    expect(costSlide.bars.map(bar => bar.name)).toEqual(['GPT-5.4', 'GLM-5.3'])
    expect(costSlide.bars[0]!.height).toBe(1)
    expect(costSlide.bars[0]!.logo).toBe('codex')
    expect(costSlide.bars[1]!.height).toBeCloseTo(3 / 7)
  })

  it('skips the token slide when no token evidence exists', () => {
    const current = currentFixture({
      modelPresentation: {
        rows: [presentationRow({ name: 'GPT-5.4', tokenDetail: false })],
        accountingRowCount: 1,
      },
    } as Partial<HomeCurrent>)

    const slides = buildUsageMixSlides(current, undefined)
    expect(slides.map(slide => slide.id)).toEqual(['cost'])
  })

  it('ranks clients by total tokens with shares relative to the leader', () => {
    const sessions: SessionRow[] = [
      session({ sessionId: '1', provider: 'codex', inputTokens: 100 }),
      session({ sessionId: '2', provider: 'zcode', inputTokens: 400, cacheWriteTokens: 100 }),
      session({ sessionId: '3', provider: 'pi', inputTokens: 250 }),
    ]

    const slides = buildUsageMixSlides(currentFixture(), sessions)
    const clientSlide = slides.find(slide => slide.kind === 'clients')
    if (clientSlide?.kind !== 'clients') throw new Error('expected a clients slide')
    expect(clientSlide.caption).toBe('Most used clients')
    expect(clientSlide.entries.map(entry => entry.id)).toEqual(['zcode', 'pi', 'codex'])
    expect(clientSlide.entries.map(entry => entry.share)).toEqual([1, 0.5, 0.2])
    expect(clientSlide.entries[0]!.logo).toBe('zcode')
  })

  it('keeps only the cost slide when sessions are missing', () => {
    const slides = buildUsageMixSlides(currentFixture(), null)
    expect(slides.map(slide => slide.id)).toEqual(['cost'])
  })
})
