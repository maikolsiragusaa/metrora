// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HarnessComposer } from './HarnessComposer'

function renderComposer(overrides: Partial<Parameters<typeof HarnessComposer>[0]> = {}) {
  const props: Parameters<typeof HarnessComposer>[0] = {
    mode: 'chat',
    swarmExperimentalEnabled: true,
    swarmRunning: false,
    loadingQuestion: null,
    hostedSubmitBlockReason: null,
    notice: null,
    composer: '',
    onModeChange: vi.fn(),
    onComposerChange: vi.fn(),
    onAsk: vi.fn(),
    onSwarmRun: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  return { ...render(<HarnessComposer {...props} />), props }
}

describe('Harness V3 composer', () => {
  it('sends on Enter, preserves Shift+Enter for multiline input, and exposes Chat/Swarm in one control', () => {
    const { props } = renderComposer({ composer: 'Inspect usage' })
    const textarea = screen.getByRole('textbox', { name: 'Ask Metrora Harness' })
    expect(screen.getByRole('combobox', { name: 'Harness execution strategy' })).toHaveValue('chat')
    fireEvent.keyDown(textarea, { key: 'Shift', shiftKey: true })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(props.onAsk).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(props.onAsk).toHaveBeenCalledWith('Inspect usage')
  })

  it('routes a Swarm task through the same composer with a bounded worker count', () => {
    const { props } = renderComposer({ mode: 'swarm', composer: 'Investigate current spend' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Swarm worker count' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Swarm' }))
    expect(props.onSwarmRun).toHaveBeenCalledWith('Investigate current spend', 3)
    expect(props.onComposerChange).toHaveBeenCalledWith('')
  })
})
