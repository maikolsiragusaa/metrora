#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import process from 'node:process'

import { validateWindowsUxAcceptanceReport } from './windows-ux-acceptance-report.mjs'

function parse(argv) {
  const result = { report: undefined, expectedCommit: undefined, allowIncomplete: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--expected-commit') {
      result.expectedCommit = argv[++index]
      if (!result.expectedCommit) throw new Error('--expected-commit requires a value')
      continue
    }
    if (value === '--allow-incomplete') {
      result.allowIncomplete = true
      continue
    }
    if (value.startsWith('--')) throw new Error(`unknown argument: ${value}`)
    if (result.report) throw new Error('only one UX acceptance report may be verified')
    result.report = value
  }
  if (!result.report) {
    throw new Error('usage: verify-windows-ux-acceptance-report.mjs <report.json> [--expected-commit <sha>] [--allow-incomplete]')
  }
  return result
}

const args = parse(process.argv.slice(2))
const report = JSON.parse(await readFile(args.report, 'utf8'))
validateWindowsUxAcceptanceReport(report, {
  ...(args.expectedCommit ? { expectedCommit: args.expectedCommit } : {}),
  requirePass: !args.allowIncomplete,
})
process.stdout.write(`Verified Metrora Windows UX acceptance report for ${report.source.commit}: ${report.candidate.productVersion}\n`)
