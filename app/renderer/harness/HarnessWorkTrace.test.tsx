import { describe, expect, it } from 'vitest'

import type { MetroraAgentLoopEvent } from '../agent-loop/contracts'
import { createHarnessCompletedWorkTrace } from './HarnessWorkTrace'

function event(type: MetroraAgentLoopEvent['type'], step = 1, tool?: string, detail?: string): MetroraAgentLoopEvent {
  return { type, turnId: 'safe-turn', step, ...(tool ? { tool } : {}), ...(detail ? { detail } : {}), at: '2026-09-02T00:00:00.000Z' }
}

describe('Harness completed work trace', () => {
  it('persists a compact model and Tool lifecycle without provider internals', () => {
    const trace = createHarnessCompletedWorkTrace([
      { name: 'get_spend_snapshot', status: 'completed' },
      { name: 'get_project_drivers', status: 'completed' },
    ], [
      event('turn-started'),
      event('model-started'),
      event('model-completed'),
      event('tool-queued', 1, 'get_project_drivers'),
      event('tool-started', 1, 'get_project_drivers'),
      event('tool-completed', 1, 'get_project_drivers'),
      event('model-started', 2),
      event('model-completed', 2),
      event('turn-completed', 2),
    ])

    expect(trace.items.map(item => item.label)).toEqual([
      'Thinking',
      'Usage checked',
      'Thinking',
      'Project breakdown checked',
      'Preparing answer',
      'Done',
    ])
    expect(trace.modelSteps).toBe(2)
    expect(trace.modelCompletions).toBe(2)
    expect(trace.toolEvents).toBe(3)
    expect(JSON.stringify(trace)).not.toMatch(/reasoning|providerMetadata|signature|encrypted|prompt|arguments/i)
  })

  it('keeps the model lifecycle visible even when a social turn has no Tools', () => {
    const trace = createHarnessCompletedWorkTrace([], [
      event('turn-started'),
      event('model-started'),
      event('model-completed'),
      event('turn-completed'),
    ])

    expect(trace.items.map(item => item.label)).toEqual(['Thinking', 'Preparing answer', 'Done'])
    expect(trace.toolEvents).toBe(0)
  })

  it('shows failed Tool identity and the reserved terminal synthesis phase', () => {
    const trace = createHarnessCompletedWorkTrace([
      { name: 'get_spend_snapshot', status: 'completed' },
      { name: 'get_model_efficiency', status: 'unavailable' },
      { name: 'get_project_drivers', status: 'completed' },
    ], [
      event('turn-started'),
      event('model-started', 1),
      event('model-completed', 1),
      event('tool-queued', 1, 'get_model_efficiency'),
      event('tool-started', 1, 'get_model_efficiency'),
      event('tool-unavailable', 1, 'get_model_efficiency'),
      event('model-started', 2),
      event('model-completed', 2),
      event('tool-queued', 2, 'get_project_drivers'),
      event('tool-started', 2, 'get_project_drivers'),
      event('tool-completed', 2, 'get_project_drivers'),
      event('model-started', 3, undefined, 'synthesize'),
      event('model-completed', 3),
      event('turn-completed', 3),
    ])

    expect(trace.items.map(item => item.label)).toEqual([
      'Thinking',
      'Usage checked',
      'Thinking',
      'Comparing models unavailable',
      'Project breakdown checked',
      'Thinking',
      'Preparing answer',
      'Done',
    ])
    expect(trace.items.find(item => item.label === 'Comparing models unavailable')?.status).toBe('failed')
  })
})
