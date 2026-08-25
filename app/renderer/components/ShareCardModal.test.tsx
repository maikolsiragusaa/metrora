// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'

const { saveShareCardPng, rasterizeShareCardPngDataUrl } = vi.hoisted(() => ({
  saveShareCardPng: vi.fn(),
  rasterizeShareCardPngDataUrl: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  metrora: { saveShareCardPng },
}))

vi.mock('../share-card', async original => {
  const actual = await original<typeof import('../share-card')>()
  return {
    ...actual,
    rasterizeShareCardPngDataUrl,
  }
})

import { ShareCardModal } from './ShareCardModal'

function payload(): MenubarPayload {
  return {
    freshness: { readMode: 'snapshot', reconciliation: 'complete', durableThrough: null },
    current: {
      calls: 640,
      sessions: 22,
      cost: 41.25,
      topModels: [{ name: 'gpt-5.6-sol', calls: 480, cost: 32, savingsUSD: 0, savingsBaselineModel: '' }],
      pricingCoverage: 1,
    },
  } as unknown as MenubarPayload
}

function previewSvg(): string {
  const src = (screen.getByAltText('Metrora AI recap share card preview') as HTMLImageElement).src
  const encoded = src.slice(src.indexOf(',') + 1)
  return decodeURIComponent(encoded)
}

describe('ShareCardModal', () => {
  beforeEach(() => {
    saveShareCardPng.mockReset().mockResolvedValue(true)
    rasterizeShareCardPngDataUrl.mockReset().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')
  })

  it('shows the exact disclosure with cost and Project name hidden by default', () => {
    render(<ShareCardModal
      payload={payload()}
      period="week"
      providerLabel="Codex"
      projectScopeActive
      projectScopeName="Private launch"
      onClose={vi.fn()}
    />)

    expect(screen.getByText('Current Project scope (name hidden)')).toBeTruthy()
    expect(screen.getByLabelText('Include exact spend')).not.toBeChecked()
    expect(screen.getByLabelText('Include Project name')).not.toBeChecked()
    expect(previewSvg()).toContain('Current Project scope')
    expect(previewSvg()).not.toContain('Private launch')
    expect(previewSvg()).not.toContain('$41.25')
  })

  it('updates the same preview when optional disclosure is explicitly enabled', () => {
    render(<ShareCardModal
      payload={payload()}
      period="week"
      providerLabel="Codex"
      projectScopeActive
      projectScopeName="Private launch"
      onClose={vi.fn()}
    />)

    fireEvent.click(screen.getByLabelText('Include exact spend'))
    fireEvent.click(screen.getByLabelText('Include Project name'))

    expect(previewSvg()).toContain('Project: Private launch')
    expect(previewSvg()).toContain('$41.25')
  })

  it('renders and saves only after the explicit Save PNG action', async () => {
    render(<ShareCardModal
      payload={payload()}
      period="30days"
      providerLabel="All providers"
      onClose={vi.fn()}
    />)

    expect(rasterizeShareCardPngDataUrl).not.toHaveBeenCalled()
    expect(saveShareCardPng).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save PNG' }))

    await waitFor(() => expect(saveShareCardPng).toHaveBeenCalledWith('metrora-ai-recap.png', 'data:image/png;base64,iVBORw0KGgo='))
    expect(rasterizeShareCardPngDataUrl).toHaveBeenCalledTimes(1)
    expect(screen.getByText('PNG saved.')).toBeTruthy()
  })
})
