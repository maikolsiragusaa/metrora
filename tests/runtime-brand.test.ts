import { describe, expect, it } from 'vitest'

import { renderOverview } from '../src/overview.js'

describe('Metrora runtime branding', () => {
  it('uses the Metrora identity in the plain-text overview', () => {
    const output = renderOverview([], { label: 'Lifetime', color: false })
    expect(output).toContain('Metrora  Lifetime')
  })
})
