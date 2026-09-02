import { describe, expect, it } from 'vitest'

import type { MetroraAgentLoopEvent } from '../agent-loop/contracts'
import { createHarnessCompletedWorkTrace } from './HarnessWorkTrace'

function event(type: MetroraAgentLoopEvent['type'], step = 1, tool?: string): MetroraAgentLoopEvent {
  return { type, turnId: 'safe-turn', step, ...(tool ? { tool } : {}), at: '2026-09-02T00:00:00.000Z' }
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
      'Models checked',
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

    expect(trace.items.map(item => item.label)).toEqual(['Thinking', 'Thinking', 'Models checked', 'Preparing answer', 'Done'])
    expect(trace.toolEvents).toBe(0)
  })
})
