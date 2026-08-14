import { describe, expect, it } from 'vitest'

import { buildCompanionUsage } from '../../src/sharing/share-run.js'
import type { MenubarPayload } from '../../src/menubar-json.js'

describe('companion usage aggregation', () => {
  it('skips the discarded granular timeline on the cold usage path', async () => {
    let observed: { label: string; options: Record<string, unknown> } | undefined
    const payload = {
      generated: '2026-08-14T00:00:00.000Z',
      current: { topProjects: ['private-project'], topSessions: [] },
      history: {},
    } as unknown as MenubarPayload

    const result = await buildCompanionUsage({ period: 'month' }, async (periodInfo, options) => {
      observed = { label: periodInfo.label, options }
      return payload
    })

    expect(observed?.label).toBeTruthy()
    expect(observed?.options).toMatchObject({
      provider: 'all',
      optimize: false,
      timeline: false,
    })
    expect(result.current.topProjects).toEqual([])
  })
})
