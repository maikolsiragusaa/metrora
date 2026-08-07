import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  const fs = await vi.importActual<typeof import('fs')>('fs')
  const fakeHome = fs.mkdtempSync(actual.tmpdir() + '/metrora-context-home-')
  process.env['METRORA_CONTEXT_TEST_HOME'] = fakeHome
  return { ...actual, homedir: () => fakeHome }
})

const HOME = process.env['METRORA_CONTEXT_TEST_HOME']!

import { estimateContextBudget } from '../src/context-budget.js'

describe('context budget home/project identity', () => {
  beforeEach(() => {
    rmSync(join(HOME, '.claude'), { recursive: true, force: true })
    mkdirSync(join(HOME, '.claude', 'skills', 'home-skill'), { recursive: true })
    writeFileSync(join(HOME, '.claude', 'skills', 'home-skill', 'SKILL.md'), '# Home skill')
    writeFileSync(join(HOME, '.claude', 'CLAUDE.md'), 'home memory')
  })

  it('counts home skills and memory once when projectPath is home', async () => {
    const budget = await estimateContextBudget(HOME)

    expect(budget.skills.count).toBe(1)
    expect(budget.memory.files.filter(file => file.name.includes('.claude/CLAUDE.md'))).toHaveLength(1)
  })

  it('also deduplicates an equivalent home path with harmless path syntax', async () => {
    const budget = await estimateContextBudget(join(HOME, '.'))

    expect(budget.skills.count).toBe(1)
    expect(budget.memory.files.filter(file => file.name.includes('.claude/CLAUDE.md'))).toHaveLength(1)
  })

  it('still counts a genuinely distinct project skill independently', async () => {
    const project = mkdtempSync(join(HOME, '..', 'metrora-context-project-'))
    try {
      mkdirSync(join(project, '.claude', 'skills', 'project-skill'), { recursive: true })
      writeFileSync(join(project, '.claude', 'skills', 'project-skill', 'SKILL.md'), '# Project skill')

      const budget = await estimateContextBudget(project)
      expect(budget.skills.count).toBe(2)
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })
})
