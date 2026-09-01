// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MetroraDialog } from './MetroraDialog'

describe('MetroraDialog', () => {
  it('closes from Escape and a backdrop click, then restores focus', async () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(
      <MetroraDialog ariaLabel="Test dialog" onClose={onClose}>
        <button type="button" data-metrora-dialog-autofocus="true">Continue</button>
      </MetroraDialog>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.click(document.querySelector('.metrora-dialog-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(2)

    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('can keep the backdrop and Escape from closing a semantic dialog', () => {
    const onClose = vi.fn()
    render(
      <MetroraDialog ariaLabel="Pinned dialog" onClose={onClose} closeOnEscape={false} closeOnBackdropClick={false}>
        <p>Content</p>
      </MetroraDialog>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('.metrora-dialog-backdrop')!)
    expect(onClose).not.toHaveBeenCalled()
  })
})
