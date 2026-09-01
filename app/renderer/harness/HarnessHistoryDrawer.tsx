import { MetroraDialog } from '../ui/overlays/MetroraDialog'

export type HarnessHistoryConversation = {
  id: string
  title: string
  messages: Array<{ text?: string; answer?: { conclusion: string } }>
}
export function HarnessHistoryDrawer({
  conversations,
  activeConversationId,
  historyQuery,
  onNewChat,
  onConversationSelect,
  onHistoryQueryChange,
  onClose,
}: {
  conversations: HarnessHistoryConversation[]
  activeConversationId: string
  historyQuery: string
  onNewChat: () => void
  onConversationSelect: (id: string) => void
  onHistoryQueryChange: (value: string) => void
  onClose: () => void
}) {
  return (
    <MetroraDialog ariaLabel="Harness history" onClose={onClose} className="harness-v3-history-dialog" backdropClassName="harness-v3-history-layer">
      <aside className="harness-v3-history" aria-label="Harness history">
        <div className="harness-v3-history-head">
          <div><span className="harness-v3-eyebrow">CONVERSATION</span><h2>History</h2><p>Session-local conversations stay secondary to the thread.</p></div>
          <button type="button" className="harness-v3-icon-button" aria-label="Close history" onClick={onClose}>×</button>
        </div>
        <button type="button" className="harness-v3-new-chat" data-metrora-dialog-autofocus onClick={() => { onNewChat(); onClose() }}>New chat</button>
        <label className="harness-v3-history-search"><span aria-hidden="true">⌕</span><input aria-label="Search Harness history" placeholder="Search this session" value={historyQuery} onChange={event => onHistoryQueryChange(event.target.value)} /></label>
        <div className="harness-v3-history-list">
          {conversations.length ? conversations.map(conversation => (
            <button key={conversation.id} type="button" className={conversation.id === activeConversationId ? 'harness-v3-history-item active' : 'harness-v3-history-item'} onClick={() => { onConversationSelect(conversation.id); onClose() }}>
              <span>{conversation.title}</span><small>{conversation.messages.length ? conversation.messages.length + ' messages' : 'Ready to explore'}</small>
            </button>
          )) : <p className="harness-v3-history-empty">No matching conversations.</p>}
        </div>
        <p className="harness-v3-history-foot">Session-local history · never synced</p>
      </aside>
    </MetroraDialog>
  )
}
