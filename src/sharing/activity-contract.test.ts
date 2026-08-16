import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_SESSIONS_KIND,
  activityQueryHash,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityQueryV1,
} from './activity-contract.js'

const query: ActivityQueryV1 = {
  period: 'month',
  projectScopeId: 'mp_demo',
  effectiveFrom: '2026-08-01',
  effectiveTo: '2026-08-15',
  provider: 'claude',
  route: 'anthropic-api',
  model: 'claude-opus-4-6',
  source: `sp_${'a'.repeat(64)}`,
  order: 'newest',
  limit: 40,
}

describe('bounded Activity contract', () => {
  it('binds opaque cursors to the complete query identity', () => {
    const cursor = encodeActivityCursor(query, ACTIVITY_SESSIONS_KIND, {
      value: '2026-08-14T10:00:00.000Z',
      secondary: '2026-08-14T10:01:00.000Z',
      id: 'session-boundary',
    })
    expect(cursor).not.toContain('mp_demo')
    expect(decodeActivityCursor(query, ACTIVITY_SESSIONS_KIND, cursor)).toEqual({
      value: '2026-08-14T10:00:00.000Z',
      secondary: '2026-08-14T10:01:00.000Z',
      id: 'session-boundary',
    })
    expect(() => decodeActivityCursor({ ...query, model: 'different-model' }, ACTIVITY_SESSIONS_KIND, cursor)).toThrow(
      'activity cursor does not match query',
    )
    expect(() => decodeActivityCursor({ ...query, source: `sp_${'b'.repeat(64)}` }, ACTIVITY_SESSIONS_KIND, cursor)).toThrow(
      'activity cursor does not match query',
    )
  })

  it('changes the cursor fingerprint when scope, bounds or ordering changes', () => {
    expect(activityQueryHash(query, ACTIVITY_SESSIONS_KIND)).not.toBe(
      activityQueryHash({ ...query, projectScopeId: 'all' }, ACTIVITY_SESSIONS_KIND),
    )
    expect(activityQueryHash(query, ACTIVITY_SESSIONS_KIND)).not.toBe(
      activityQueryHash({ ...query, order: 'cost' }, ACTIVITY_SESSIONS_KIND),
    )
    expect(activityQueryHash(query, ACTIVITY_SESSIONS_KIND)).not.toBe(
      activityQueryHash({ ...query, period: 'lifetime' }, ACTIVITY_SESSIONS_KIND),
    )
    expect(activityQueryHash(query, ACTIVITY_SESSIONS_KIND)).not.toBe(
      activityQueryHash({ ...query, source: `sp_${'b'.repeat(64)}` }, ACTIVITY_SESSIONS_KIND),
    )
  })
})
