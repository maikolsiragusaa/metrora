// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { createAdvisorConformanceFixture } from './conformance'
import { createAdvisorKernel } from './kernel'
import { buildConversationEvidence } from './special-evidence'
import { OllamaAdvisorRuntime, type OllamaTransport } from './ollama'
import { advisorScopeFingerprint, type AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function directTransport(
  requests: Array<Record<string, unknown>>,
  response: { content: string; toolCalls?: Array<Record<string, unknown>> },
): OllamaTransport {
  return {
    probe: async () => ({ available: true, models: ['chat-model'], detail: 'ready' }),
    cancel: async () => true,
    onDelta: () => () => {},
    chat: async (_requestId, payload) => {
      requests.push(payload)
      return {
        streamed: false,
        message: {
          content: response.content,
          ...(response.toolCalls ? { tool_calls: response.toolCalls } : {}),
        },
      }
    },
  }
}

describe('Advisor chat-first model boundary', () => {
  it.each([
    'Ciao',
    'Come va oggi?',
    'Mi vuoi bene?',
    'Chi sei?',
    'Puoi aiutarmi a codare?',
    'Write a small TypeScript sorting function',
    "Raccontami in breve cos'è SQLite",
    'Bonjour, comment ça va ?',
  ])('lets a capable model answer "%s" without a Metrora read', async question => {
    const fixture = createAdvisorConformanceFixture()
    const requests: Array<Record<string, unknown>> = []
    const runtime = new OllamaAdvisorRuntime({
      model: 'chat-model',
      transport: directTransport(requests, { content: 'I can help explain that naturally.' }),
    })

    const answer = await createAdvisorKernel(fixture.source, runtime).investigate({ question, scope: fixture.scope })

    expect(requests).toHaveLength(1)
    expect(fixture.reads.overviews).toHaveLength(0)
    expect(fixture.reads.models).toHaveLength(0)
    expect(fixture.reads.quotas).toBe(0)
    expect(answer.conclusion).toBe('I can help explain that naturally.')
    expect(answer.evidence).toEqual([])
    expect(answer.coverage).toMatchObject({ level: 'high', label: 'Conversation' })
    expect(answer.nextInvestigations).toEqual([])
    expect(answer.generatedByModel).toBe(true)
  })

  it('keeps operational requests proposal-only even when the model emits a tool call', async () => {
    const fixture = createAdvisorConformanceFixture()
    const requests: Array<Record<string, unknown>> = []
    const runtime = new OllamaAdvisorRuntime({
      model: 'chat-model',
      transport: directTransport(requests, {
        content: '',
        toolCalls: [{ function: { name: 'run_bench', arguments: {} } }],
      }),
    })

    const answer = await createAdvisorKernel(fixture.source, runtime).investigate({ question: 'Run this benchmark.', scope: fixture.scope })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.tools).toEqual([])
    expect(fixture.reads.overviews).toHaveLength(0)
    expect(fixture.reads.models).toHaveLength(0)
    expect(fixture.reads.quotas).toBe(0)
    expect(answer.actionProposal).toMatchObject({ kind: 'run-bench', status: 'proposal-only' })
    expect(answer.conclusion).toMatch(/not authorized|not an authorized|not executable|requires/i)
  })

  it('sends only bounded same-scope history and minimal semantic context', async () => {
    const requests: Array<Record<string, unknown>> = []
    const fingerprint = advisorScopeFingerprint(scope)
    const runtime = new OllamaAdvisorRuntime({
      model: 'chat-model',
      transport: directTransport(requests, { content: 'Here is the conversational follow-up.' }),
    })

    await runtime.generate({
      question: 'E ieri?',
      evidence: buildConversationEvidence('E ieri?', scope),
      conversation: [
        { role: 'user', content: 'Quanto ho speso oggi?', scopeFingerprint: fingerprint },
        { role: 'assistant', content: 'The prior answer was shown in the conversation.', scopeFingerprint: fingerprint },
        { role: 'assistant', content: 'Do not send this other scope context.', scopeFingerprint: 'other-scope' },
      ],
      uiContext: {
        contractVersion: 'advisor-ui-context-v1',
        schemaVersion: 1,
        currentSurface: 'Home',
        period: 'today',
        provider: 'all',
        project: 'All projects',
        model: null,
        relevantReferences: ['visible spend card'],
      },
      tools: [],
    })

    const messages = requests[0]?.messages as Array<{ role: string; content: string }>
    const contents = messages.map(message => message.content)
    expect(contents[0]).toContain('"period":"week"')
    expect(contents[0]).toContain('"project":"All projects"')
    expect(contents[0]).not.toContain('advisor-ui-context-v1')
    expect(contents[0]).not.toContain('currentSurface')
    expect(contents[0]).not.toContain('relevantReferences')
    expect(contents[0]).not.toContain('schemaVersion')
    expect(contents).toContain('Quanto ho speso oggi?')
    expect(contents).toContain('The prior answer was shown in the conversation.')
    expect(contents).not.toContain('Do not send this other scope context.')
  })
})

describe('Advisor factual follow-up', () => {
  it('resolves a factual Italian follow-up through one bounded read and keeps a second read available', async () => {
    const fixture = createAdvisorConformanceFixture()
    const requests: Array<Record<string, unknown>> = []
    let calls = 0
    const fingerprint = advisorScopeFingerprint(fixture.scope)
    const runtime = new OllamaAdvisorRuntime({
      model: 'chat-model',
      transport: {
        probe: async () => ({ available: true, models: ['chat-model'], detail: 'ready' }),
        cancel: async () => true,
        onDelta: () => () => {},
        chat: async (_requestId, payload) => {
          requests.push(payload)
          calls += 1
          return calls === 1
            ? { streamed: false, message: { content: '', tool_calls: [{ function: { name: 'get_spend_snapshot', arguments: {} } }] } }
            : {
                streamed: false,
                message: {
                  content: JSON.stringify({
                    contractVersion: 'advisor-synthesis-draft-v1',
                    schemaVersion: 1,
                    conclusion: { claimIds: ['measured-total-cost'] },
                    why: [{ claimIds: ['observed-calls'] }],
                    details: [{ claimIds: ['observed-sessions'] }],
                    claims: [{ id: 'measured-total-cost' }, { id: 'observed-calls' }, { id: 'observed-sessions' }],
                    presentationRequests: [],
                  }),
                },
              }
        },
      },
    })

    const answer = await createAdvisorKernel(fixture.source, runtime).investigate({
      question: 'Perché 2$?',
      scope: fixture.scope,
      conversation: [
        { role: 'user', content: 'Quanto ho speso oggi?', scopeFingerprint: fingerprint },
        { role: 'assistant', content: 'Hai speso 12 USD.', scopeFingerprint: fingerprint },
        { role: 'assistant', content: 'Do not cross this other scope.', scopeFingerprint: 'other-scope' },
      ],
    })

    expect(requests).toHaveLength(2)
    expect((requests[0]?.tools as Array<{ function?: { name?: string } }>).some(tool => tool.function?.name === 'get_spend_snapshot')).toBe(true)
    expect((requests[1]?.tools as Array<{ function?: { name?: string } }>).some(tool => tool.function?.name === 'get_spend_snapshot')).toBe(true)
    const firstContents = (requests[0]?.messages as Array<{ content: string }>).map(message => message.content)
    expect(firstContents).toContain('Quanto ho speso oggi?')
    expect(firstContents).toContain('Hai speso 12 USD.')
    expect(firstContents).not.toContain('Do not cross this other scope.')
    expect(fixture.reads.overviews).toHaveLength(1)
    expect(answer.conclusion).toContain('12,00')
    expect(answer.claims?.map(claim => claim.id)).toEqual(['measured-total-cost', 'observed-calls', 'observed-sessions'])
  })
 
})
