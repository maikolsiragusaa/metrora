// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { UpdateBanner } from './UpdateBanner'

describe('UpdateBanner', () => {
  it('renders no inherited update prompt while Metrora has no verified release channel', () => {
    const { container } = render(<UpdateBanner />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/Metrora/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
  })
})
