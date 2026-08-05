import { describe, expect, it } from 'vitest'

import { matchesDurableProjectFilter } from '../src/durable-project-reconciliation.js'
import { filterProjectsByName } from '../src/parser.js'
import type { ProjectSummary } from '../src/types.js'

function project(name: string, path: string): ProjectSummary {
  return { project: name, projectPath: path } as ProjectSummary
}

describe('durable project matcher parity', () => {
  it.each([
    { include: ['ALPHA'], exclude: [] },
    { include: ['/teams/core'], exclude: [] },
    { include: [], exclude: ['sandbox'] },
    { include: ['repo'], exclude: ['legacy'] },
    { include: ['constructor'], exclude: [] },
  ])('matches the parser include/exclude contract for $include / $exclude', filter => {
    const candidates = [
      project('alpha-service', '/teams/core/alpha-service'),
      project('beta-sandbox', '/teams/labs/beta-sandbox'),
      project('legacy-repo', '/teams/core/legacy-repo'),
      project('constructor', '/teams/core/constructor'),
    ]

    const parserResult = filterProjectsByName(candidates, filter.include, filter.exclude)
      .map(candidate => candidate.project)
    const durableResult = candidates
      .filter(candidate => matchesDurableProjectFilter(
        candidate.project,
        candidate.projectPath,
        filter,
      ))
      .map(candidate => candidate.project)

    expect(durableResult).toEqual(parserResult)
  })
})
