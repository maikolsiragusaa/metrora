// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HarnessHistoryDrawer } from './HarnessHistoryDrawer'

const conversations = [
  { id: 'new', title: 'New chat', messages: [] },
  { id: 'usage', title: 'Inspect usage', messages: [{ text: 'Inspect usage' }] },
]

describe('Harness V3 history drawer', () => {
  it('keeps new chat and conversation selection inside the secondary drawer', () => {
    const onNewChat = vi.fn()
    const onConversationSelect = vi.fn()
    const onClose = vi.fn()
    render(<HarnessHistoryDrawer conversations={conversations} activeConversationId="new" historyQuery="" onNewChat={onNewChat} onConversationSelect={onConversationSelect} onHistoryQueryChange={vi.fn()} onClose={onClose} />)

    expect(screen.getByRole('complementary', { name: 'Harness history' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Inspect usage/ }))
    expect(onConversationSelect).toHaveBeenCalledWith('usage')
    expect(onClose).toHaveBeenCalled()
  })

  it('starts a new session without changing the current thread content directly', () => {
    const onNewChat = vi.fn()
    render(<HarnessHistoryDrawer conversations={conversations} activeConversationId="usage" historyQuery="" onNewChat={onNewChat} onConversationSelect={vi.fn()} onHistoryQueryChange={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(onNewChat).toHaveBeenCalledOnce()
  })
})
