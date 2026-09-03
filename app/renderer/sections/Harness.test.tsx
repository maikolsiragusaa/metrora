// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Polled } from '../hooks/usePolled'
import type { MenubarPayload } from '../lib/types'
import type {
  HarnessConversation,
  HarnessConversationInput,
  HarnessConversationSummary,
  HarnessRuntimeProfileV1,
  HarnessWorkspace,
  MetroraHarnessRuntimeEvent,
} from '../../electron/harness-runtime-types'
import { Harness } from './Harness'

const bridge = vi.hoisted(() => ({
  harnessProfileGet: vi.fn(),
  harnessWorkspaceGet: vi.fn(),
  harnessWorkspaceOpen: vi.fn(),
  chooseDirectory: vi.fn(),
  harnessProbeLocal: vi.fn(),
  harnessProbeHosted: vi.fn(),
  harnessListConversations: vi.fn(),
  harnessGetConversation: vi.fn(),
  harnessCreateConversation: vi.fn(),
  harnessSendMessage: vi.fn(),
  harnessSelectModelForSession: vi.fn(),
  harnessCancel: vi.fn(),
  harnessApprove: vi.fn(),
  harnessDeny: vi.fn(),
  harnessProfileSetRuntime: vi.fn(),
  harnessProfileSetPort: vi.fn(),
  harnessProfileSetLocalModel: vi.fn(),
  harnessProfileSetHostedModel: vi.fn(),
  harnessProfileSetReasoning: vi.fn(),
  harnessProfileSetConsent: vi.fn(),
  harnessCredentialSet: vi.fn(),
  harnessMcpGet: vi.fn(),
  harnessMcpSetServers: vi.fn(),
  harnessMcpReload: vi.fn(),
  harnessMcpCredentialSet: vi.fn(),
  harnessCheckConformance: vi.fn(),
  onHarnessRuntimeEvent: vi.fn((_callback: (event: MetroraHarnessRuntimeEvent) => void) => () => {}),
}))

vi.mock('../lib/ipc', () => ({ metrora: bridge }))

const profile: HarnessRuntimeProfileV1 = {
  version: 1,
  runtime: 'ollama',
  lastLocalRuntime: 'ollama',
  lastLocalModelByRuntime: { ollama: 'qwen2.5-coder' },
  lastHostedModelByProvider: {},
  llamaServerPort: 8080,
  reasoningByModel: { [JSON.stringify(['ollama', null, 'qwen2.5-coder'])]: 'medium' },
  hostedConsentByProvider: {},
  lastUsable: { runtime: 'ollama', provider: null, model: 'qwen2.5-coder' },
  mcpServers: [],
  ui: { showReasoning: true, compactProcess: true, density: 'comfortable' },
}

const workspace: HarnessWorkspace = { id: 'workspace-0123456789abcdef', displayName: 'Metrora project', relativeRoot: '.', available: true }
const summary: HarnessConversationSummary = {
  id: 'session-1',
  title: 'Inspect the project',
  createdAt: '2026-09-03T12:00:00.000Z',
  updatedAt: '2026-09-03T12:03:00.000Z',
  messageCount: 2,
  runtime: 'ollama',
  provider: null,
  model: 'qwen2.5-coder',
  mode: 'ask',
  reasoningEffort: 'medium',
  workspace,
  conformance: { state: 'unavailable', fingerprint: null, toolCalling: 'unknown', reasoning: 'unknown', checkedAt: null, detail: 'Not checked.' },
}
const answer: HarnessConversation = {
  ...summary,
  messages: [
    { id: 'user-1', role: 'user', text: 'Inspect the project.' },
    { id: 'assistant-1', role: 'assistant', text: 'The selected Workspace is ready.' },
  ],
}

function renderHarness() {
  return render(<Harness period="today" provider="all" projectScopeId="all" range={null} overview={{ data: { projectScope: { options: [] } } } as unknown as Polled<MenubarPayload>} detectedProviders={[]} />)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  bridge.harnessProfileGet.mockResolvedValue(profile)
  bridge.harnessWorkspaceGet.mockResolvedValue(null)
  bridge.harnessWorkspaceOpen.mockResolvedValue(workspace)
  bridge.chooseDirectory.mockResolvedValue('C:\\workspace')
  bridge.harnessProbeLocal.mockResolvedValue({ runtime: 'ollama', endpoint: 'http://127.0.0.1:11434', available: true, models: ['qwen2.5-coder'], detail: 'Local Ollama is reachable.', discoveryState: 'models-discovered', capabilities: [{ schemaVersion: 1, runtime: 'ollama', modelId: 'qwen2.5-coder', discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', reasoningEfforts: ['medium'], limitation: 'Exact Tool and reasoning conformance is checked separately for this exact model.' }] })
  bridge.harnessListConversations.mockResolvedValue([])
  bridge.harnessGetConversation.mockResolvedValue(null)
  bridge.harnessCreateConversation.mockResolvedValue({ ...summary, messages: [] })
  bridge.harnessSendMessage.mockResolvedValue({ conversationId: summary.id, message: answer.messages[1], runtime: 'ollama', provider: null, model: 'qwen2.5-coder' })
  bridge.harnessSelectModelForSession.mockImplementation(async (input: HarnessConversationInput) => ({ ...answer, ...summary, id: input.conversationId!, runtime: input.runtime, provider: input.provider ?? null, model: input.model, mode: input.mode ?? 'ask', reasoningEffort: input.reasoningEffort ?? null }))
  bridge.harnessGetConversation.mockResolvedValue(answer)
  bridge.harnessApprove.mockResolvedValue(true)
  bridge.harnessDeny.mockResolvedValue(true)
  bridge.harnessProfileSetRuntime.mockResolvedValue(profile)
  bridge.harnessProfileSetLocalModel.mockResolvedValue(profile)
  bridge.harnessProfileSetReasoning.mockResolvedValue(profile)
  bridge.harnessProfileSetPort.mockResolvedValue(profile)
  bridge.harnessProfileSetConsent.mockResolvedValue(profile)
  bridge.harnessCredentialSet.mockResolvedValue({ provider: 'openai', state: 'ready' })
  bridge.harnessMcpGet.mockResolvedValue([])
  bridge.harnessMcpSetServers.mockResolvedValue({ profile, statuses: [] })
  bridge.harnessMcpReload.mockResolvedValue([])
  bridge.harnessMcpCredentialSet.mockResolvedValue({ reference: 'mcp:server:AUTH', state: 'ready' })
})

describe('Metrora Harness cockpit', () => {
  it('renders the durable Session rail, current Workspace and standard controls, then sends through the selected Session', async () => {
    renderHarness()

    expect(await screen.findByRole('heading', { name: 'Start a coding Session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Harness mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Harness model' })).toHaveTextContent('medium')
    expect(document.body.textContent).not.toContain(['Ad', 'visor'].join(''))

    fireEvent.click(screen.getByRole('button', { name: /Open Workspace/i }))
    await waitFor(() => expect(bridge.harnessWorkspaceOpen).toHaveBeenCalledWith('C:\\workspace'))
    expect((await screen.findAllByText('Metrora project')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /New Session/i }))
    await waitFor(() => expect(bridge.harnessCreateConversation).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Harness' }), { target: { value: 'Inspect the project.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(bridge.harnessSendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen2.5-coder', mode: 'ask', question: 'Inspect the project.' })))
    expect(await screen.findByText('The selected Workspace is ready.')).toBeInTheDocument()
  })

  it('hydrates a prior Session and resolves its exact inline Shield approval', async () => {
    const approvalConversation: HarnessConversation = {
      ...summary,
      messages: [{
        id: 'assistant-approval',
        role: 'assistant',
        text: 'A bounded edit is ready for approval.',
        process: [{
          kind: 'approval',
          item: {
            approvalId: 'approval-1',
            callId: 'edit-call-1',
            toolName: 'edit',
            action: 'Metrora Shield requires approval before this Workspace action.',
            workspacePath: 'src/index.ts',
            risk: 'workspace-mutation',
            state: 'proposed',
            reason: 'Approve the focused edit.',
          },
        }],
      }],
    }
    bridge.harnessListConversations.mockResolvedValue([summary])
    bridge.harnessGetConversation.mockResolvedValue(approvalConversation)
    renderHarness()

    expect(await screen.findByText('A bounded edit is ready for approval.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show details'))
    expect(screen.getByText('Shield · edit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(bridge.harnessApprove).toHaveBeenCalledWith('approval-1'))
  })

  it('changes the model through the active Session and keeps it after remount', async () => {
    const modelA = 'qwen-a'
    const modelB = 'qwen-b'
    const summaryA: HarnessConversationSummary = { ...summary, model: modelA, reasoningEffort: 'medium' }
    const summaryB: HarnessConversationSummary = { ...summary, model: modelB, reasoningEffort: 'high', updatedAt: '2026-09-03T12:05:00.000Z' }
    const answerA: HarnessConversation = { ...summaryA, messages: answer.messages }
    const answerB: HarnessConversation = { ...summaryB, messages: answer.messages }
    const testProfile: HarnessRuntimeProfileV1 = {
      ...profile,
      lastLocalModelByRuntime: { ollama: modelA },
      reasoningByModel: { ...profile.reasoningByModel, [JSON.stringify(['ollama', null, modelB])]: 'high' },
    }
    bridge.harnessProfileGet.mockResolvedValue(testProfile)
    bridge.harnessListConversations.mockResolvedValue([summaryA])
    bridge.harnessGetConversation.mockResolvedValue(answerA)
    bridge.harnessProbeLocal.mockResolvedValue({
      runtime: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      available: true,
      models: [modelA, modelB],
      detail: 'Local Ollama is reachable.',
      discoveryState: 'models-discovered',
      capabilities: [
        { schemaVersion: 1, runtime: 'ollama', modelId: modelA, discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', reasoningEfforts: ['medium'], limitation: 'Exact Tool and reasoning conformance is checked separately for this exact model.' },
        { schemaVersion: 1, runtime: 'ollama', modelId: modelB, discovery: 'discovered', conversational: 'available', toolCall: 'unknown', streaming: 'supported', reasoningEfforts: ['high'], limitation: 'Exact Tool and reasoning conformance is checked separately for this exact model.' },
      ],
    })
    bridge.harnessSelectModelForSession.mockImplementation(async (input: HarnessConversationInput) => ({
      ...answerB,
      id: input.conversationId!,
      runtime: input.runtime,
      provider: input.provider ?? null,
      model: input.model,
      mode: input.mode ?? 'ask',
      reasoningEffort: input.reasoningEffort ?? null,
    }))
    localStorage.setItem('harness.activeSession', summaryA.id)

    const rendered = renderHarness()
    const modelButton = await screen.findByRole('button', { name: 'Harness model' })
    await waitFor(() => expect(modelButton).toHaveTextContent(modelA))
    fireEvent.click(modelButton)
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`${modelA}.*Ollama`) }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: new RegExp(modelB) }))
    await waitFor(() => expect(bridge.harnessSelectModelForSession).toHaveBeenCalledWith(expect.objectContaining({ conversationId: summaryA.id, runtime: 'ollama', model: modelB, mode: 'ask', reasoningEffort: 'high' })))
    await waitFor(() => expect(modelButton).toHaveTextContent(modelB))

    bridge.harnessGetConversation.mockResolvedValue(answerB)
    bridge.harnessListConversations.mockResolvedValue([summaryB])
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Metrora Harness' }), { target: { value: 'Use model B.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(bridge.harnessSendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: summaryA.id, model: modelB, reasoningEffort: 'high', question: 'Use model B.' })))

    rendered.unmount()
    renderHarness()
    const remountedModelButton = await screen.findByRole('button', { name: 'Harness model' })
    await waitFor(() => expect(remountedModelButton).toHaveTextContent(modelB))
  })
})
