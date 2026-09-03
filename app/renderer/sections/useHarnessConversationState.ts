import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { advisorScopeFingerprint, type AdvisorAnswer, type AdvisorScope } from '../advisor/types'
import { metrora } from '../lib/ipc'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import type { HarnessConversation } from '../../electron/harness-runtime-types'

export type AdvisorMessage = {
  id: string
  role: 'user' | 'assistant'
  text?: string
  answer?: AdvisorAnswer
  scopeFingerprint: string
}

export type AdvisorConversation = {
  id: string
  title: string
  messages: AdvisorMessage[]
}

type HarnessStatusSetter = Dispatch<SetStateAction<string | null>>

function makeConversationId(): string {
  return 'chat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

function statusLabel(state: string): string {
  return ({
    thinking: 'Thinking…',
    reading: 'Reading…',
    searching: 'Search…',
    'running-agent': 'Running Agent…',
    'waiting-approval': 'Waiting approval…',
    preparing: 'Preparing…',
    done: 'Done',
    cancelled: 'Request cancelled',
    failed: 'Harness request failed',
  } as Record<string, string>)[state] ?? 'Thinking…'
}

/** Owns durable conversation hydration and the product-safe Harness event projection. */
export function useHarnessConversationState(scope: AdvisorScope, loadingQuestion: string | null, setToolStatus: HarnessStatusSetter) {
  const [conversations, setConversations] = useState<AdvisorConversation[]>(() => [{ id: makeConversationId(), title: 'New chat', messages: [] }])
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0]!.id)
  const initialConversationId = useRef(activeConversationId)
  const [harnessActions, setHarnessActions] = useState<Record<string, MetroraHarnessActionEvent>>({})

  useEffect(() => {
    const list = metrora.harnessListConversations
    const get = metrora.harnessGetConversation
    if (typeof list !== 'function' || typeof get !== 'function') return
    let disposed = false
    void (async () => {
      try {
        const summaries = await list()
        const loaded = (await Promise.all(summaries.map(summary => get(summary.id)))).filter((item): item is HarnessConversation => item !== null)
        if (disposed || loaded.length === 0) return
        const fingerprint = advisorScopeFingerprint(scope)
        setConversations(current => current.some(conversation => conversation.messages.length > 0)
          ? current
          : loaded.map(conversation => ({
              id: conversation.id,
              title: conversation.title,
              messages: conversation.messages.map(message => ({ ...message, scopeFingerprint: fingerprint })),
            })))
        setActiveConversationId(current => current === initialConversationId.current ? loaded[0]!.id : current)
      } catch {
        // Older packaged builds and first-run empty stores keep the local
        // compatibility conversation surface.
      }
    })()
    return () => { disposed = true }
  }, [scope])

  useEffect(() => {
    const subscribe = metrora.onHarnessRuntimeEvent
    if (typeof subscribe !== 'function') return
    return subscribe(event => {
      if (!loadingQuestion || event.conversationId !== activeConversationId) return
      setToolStatus(statusLabel(event.state))
    })
  }, [activeConversationId, loadingQuestion, setToolStatus])

  useEffect(() => {
    const subscribe = metrora.onHarnessActionEvent
    if (typeof subscribe !== 'function') return
    return subscribe(event => setHarnessActions(current => ({ ...current, [event.actionId]: event })))
  }, [])

  return { conversations, setConversations, activeConversationId, setActiveConversationId, harnessActions, setHarnessActions }
}
