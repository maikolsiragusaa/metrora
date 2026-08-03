#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ownPath = relative(repositoryRoot, fileURLToPath(import.meta.url)).replaceAll('\\', '/')

const forbidden = [
  {
    value: ['Maikol', 'Siragusa'].join(' '),
    message: 'personal founder name must not appear in ordinary public repository surfaces',
  },
  {
    value: ['metrora', 'infra'].join('-'),
    message: 'private infrastructure repository identity must not appear publicly',
  },
  {
    value: ['metrora', 'commercial'].join('-'),
    message: 'private commercial repository identity must not appear publicly',
  },
  ...['Ltd', 'LLC', 'Inc.', 'S.r.l.', 'GmbH'].map(suffix => ({
    value: ['Vensent', suffix].join(' '),
    message: 'Vensent must not be represented as a separate incorporated entity without verified legal status',
  })),
]

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean)

const findings = []
for (const path of tracked) {
  const normalized = path.replaceAll('\\', '/')
  if (normalized === ownPath) continue

  let bytes
  try {
    bytes = readFileSync(resolve(repositoryRoot, path))
  } catch (error) {
    findings.push({ path: normalized, line: 1, message: `tracked file could not be read: ${error.message}` })
    continue
  }

  if (bytes.includes(0)) continue
  const text = bytes.toString('utf8')
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of forbidden) {
      if (!lines[index].includes(rule.value)) continue
      findings.push({ path: normalized, line: index + 1, message: rule.message })
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`::error file=${finding.path},line=${finding.line}::${finding.message}`)
  }
  process.exit(1)
}

console.log(`Public identity boundary passed across ${tracked.length} tracked files.`)
