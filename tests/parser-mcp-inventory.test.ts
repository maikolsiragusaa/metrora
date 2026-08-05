import { describe, it, expect } from 'vitest'

import { extractMcpInventory } from '../src/parser.js'
import type { JournalEntry } from '../src/types.js'

function entry(overrides: Partial<JournalEntry> & Record<string, unknown>): JournalEntry {
  return { type: 'attachment', ...overrides } as JournalEntry
}

describe('extractMcpInventory', () => {
  it('returns empty array when no entries have an attachment', () => {
    expect(extractMcpInventory([entry({ type: 'user' })])).toEqual([])
  })

  it('returns empty array when no deferred_tools_delta is present', () => {
    expect(extractMcpInventory([
      entry({ attachment: { type: 'something_else', addedNames: ['mcp__a__b'] } }),
    ])).toEqual([])
  })

  it('extracts mcp__server__tool names from a single delta', () => {
    const result = extractMcpInventory([
      entry({
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['Bash', 'Edit', 'mcp__hf__hub_repo_search', 'mcp__hf__paper_search'],
        },
      }),
    ])
    expect(result).toEqual(['mcp__hf__hub_repo_search', 'mcp__hf__paper_search'])
  })

  it('filters out built-in tools (no mcp__ prefix)', () => {
    const result = extractMcpInventory([
      entry({
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['Bash', 'Edit', 'WebFetch', 'mcp__svc__t1'],
        },
      }),
    ])
    expect(result).toEqual(['mcp__svc__t1'])
  })

  it('rejects malformed names: empty server segment', () => {
    const result = extractMcpInventory([
      entry({
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['mcp____tool', 'mcp__svc__t1'],
        },
      }),
    ])
    expect(result).toEqual(['mcp__svc__t1'])
  })

  it('rejects malformed names: missing tool segment (no second `__`)', () => {
    const result = extractMcpInventory([
      entry({
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['mcp__server', 'mcp__svc__t1'],
        },
      }),
    ])
    expect(result).toEqual(['mcp__svc__t1'])
  })

  it('rejects malformed names: empty tool segment (trailing `__`)', () => {
    const result = extractMcpInventory([
      entry({
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['mcp__server__', 'mcp__svc__t1'],
        },
      }),
    ])
    expect(result).toEqual(['mcp__svc__t1'])
  })

  it('unions across multiple delta entries (incremental adds)', () => {
    const result = extractMcpInventory([
      entry({ attachment: { type: 'deferred_tools_delta', addedNames: ['mcp__a__t1'] } }),
      entry({ attachment: { type: 'deferred_tools_delta', addedNames: ['mcp__a__t2', 'mcp__b__t1'] } }),
    ])
    expect(result).toEqual(['mcp__a__t1', 'mcp__a__t2', 'mcp__b__t1'])
  })

  it('deduplicates names seen in multiple deltas', () => {
    const result = extractMcpInventory([
      entry({ attachment: { type: 'deferred_tools_delta', addedNames: ['mcp__a__t1', 'mcp__a__t1'] } }),
      entry({ attachment: { type: 'deferred_tools_delta', addedNames: ['mcp__a__t1'] } }),
    ])
    expect(result).toEqual(['mcp__a__t1'])
  })

  it('tolerates missing or non-string addedNames', () => {
    const result = extractMcpInventory([
      entry({ attachment: { type: 'deferred_tools_delta' } }),
      entry({ attachment: { type: 'deferred_tools_delta', addedNames: 'not-an-array' } }),
      entry({ attachment: { type: 'deferred_tools_delta', addedNames: [42, null, 'mcp__svc__t1', undefined] } }),
    ])
    expect(result).toEqual(['mcp__svc__t1'])
  })

  it('tolerates malformed attachment object', () => {
    const result = extractMcpInventory([
      entry({ attachment: null }),
      entry({ attachment: 'string-not-object' }),
      entry({ attachment: { type: 'deferred_tools_delta', addedNames: ['mcp__svc__t1'] } }),
    ])
    expect(result).toEqual(['mcp__svc__t1'])
  })

  it('returns names in sorted order', () => {
    const result = extractMcpInventory([
      entry({
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['mcp__zzz__a', 'mcp__aaa__z', 'mcp__mmm__m'],
        },
      }),
    ])
    expect(result).toEqual(['mcp__aaa__z', 'mcp__mmm__m', 'mcp__zzz__a'])
  })
})
