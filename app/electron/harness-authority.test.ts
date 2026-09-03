// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { createMetroraHarnessAuthority } from './harness-authority.mjs'

describe('Metrora Harness Shield Git policy', () => {
  it('classifies normal inspection separately from local, destructive and remote operations', () => {
    const authority = createMetroraHarnessAuthority()
    expect(authority.classify('bash', { command: 'git status --short' })).toBe('read-only')
    expect(authority.classify('bash', { command: 'git diff --cached' })).toBe('read-only')
    expect(authority.classify('bash', { command: 'git log --oneline -5' })).toBe('read-only')
    expect(authority.classify('bash', { command: 'git add src/index.ts' })).toBe('git-local')
    expect(authority.classify('bash', { command: 'git commit -m "bounded"' })).toBe('git-local')
    expect(authority.classify('bash', { command: 'git reset --hard HEAD' })).toBe('git-destructive')
    expect(authority.classify('bash', { command: 'git tag v1.0.0' })).toBe('git-destructive')
    expect(authority.classify('bash', { command: 'git push --force origin main' })).toBe('git-remote')
  })

  it('requires Shield approval for Git mutation and remote actions', () => {
    const authority = createMetroraHarnessAuthority()
    const context = { mode: 'build' as const, workspaceRoot: 'C:\\workspace' }
    expect(authority.decide({ name: 'bash', arguments: { command: 'git status' } }, context)).toEqual({ kind: 'allow' })
    expect(authority.decide({ name: 'bash', arguments: { command: 'git add src/index.ts' } }, context).kind).toBe('ask')
    expect(authority.decide({ name: 'bash', arguments: { command: 'git push origin main' } }, context).kind).toBe('ask')
    expect(authority.decide({ name: 'bash', arguments: { command: 'git clean -fdx' } }, context).kind).toBe('ask')
  })

  it('keeps Plan mode strictly read-only', () => {
    const authority = createMetroraHarnessAuthority()
    const context = { mode: 'plan' as const, workspaceRoot: 'C:\\workspace' }
    expect(authority.decide({ name: 'write', arguments: { path: 'notes.md' } }, context)).toEqual({
      kind: 'deny',
      reason: 'Plan mode is read-only; state-changing actions are not permitted.',
    })
    expect(authority.decide({ name: 'bash', arguments: { command: 'git push origin main' } }, context)).toEqual({
      kind: 'deny',
      reason: 'Plan mode is read-only; state-changing actions are not permitted.',
    })
  })
})
