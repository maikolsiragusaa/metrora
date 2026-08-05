import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const VERSION_CHECK_COMMAND = 'node scripts/check-version-consistency.mjs'

const RELEASE_EXACT = new Set([
  'CHANGELOG.md',
  'RELEASING.md',
  'package.json',
  'package-lock.json',
  'app/package.json',
  'app/package-lock.json',
  'app/DISTRIBUTION.md',
  'docs/VERSIONING.md',
  'docs/WINDOWS_DISTRIBUTION.md',
])

const DOCUMENTATION_EXACT = new Set([
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'GOVERNANCE.md',
  'UPSTREAM.md',
  'THIRD_PARTY_NOTICES.md',
  'AUTHORS',
  'COPYING',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'NOTICE',
  'NOTICE.md',
  'NOTICE.txt',
  '.github/PULL_REQUEST_TEMPLATE.md',
])

const PARSER_EXACT = new Set([
  'src/parser.ts',
  'src/daily-cache.ts',
  'src/usage-aggregator.ts',
  'tests/parser.test.ts',
  'tests/parser-incremental-append.test.ts',
  'tests/cli-durable-totals.test.ts',
])

const LOCAL_STATE_EXACT = new Set([
  'tests/cache-refresh-lock.test.ts',
])

const GENERATED_PRICING_DOCUMENTS = new Set([
  'docs/PRICING_HISTORY.md',
])

const GENERATED_PROVIDER_DOCUMENTS = new Set([
  'docs/COLLECTOR_INVENTORY_V1.md',
])

function normalized(path) {
  return path.replaceAll('\\', '/')
}

function emptyClassification() {
  return {
    parser: false,
    providers: false,
    local_state: false,
    pricing: false,
    desktop: false,
    release: false,
    powershell: false,
    fallback_core: false,
    documentation_only: true,
    fallback_paths: [],
  }
}

export function failClosedClassification(reason) {
  const result = emptyClassification()
  result.documentation_only = false
  result.fallback_core = true
  result.fallback_paths.push(reason)
  return result
}

function isDocumentationPath(path) {
  return DOCUMENTATION_EXACT.has(path) ||
    path.startsWith('docs/') ||
    path.startsWith('LICENSES/') ||
    path.startsWith('.github/ISSUE_TEMPLATE/') ||
    path.startsWith('.github/PULL_REQUEST_TEMPLATE/')
}

export function classifyDraftPaths(inputPaths) {
  const result = emptyClassification()

  for (const rawPath of inputPaths) {
    const path = normalized(rawPath).trim()
    if (!path) continue

    if (path.endsWith('.ps1')) {
      result.release = true
      result.powershell = true
      result.documentation_only = false
      continue
    }

    if (
      RELEASE_EXACT.has(path) ||
      path.startsWith('.github/workflows/') ||
      path.startsWith('scripts/')
    ) {
      result.release = true
      result.documentation_only = false
      continue
    }

    if (GENERATED_PRICING_DOCUMENTS.has(path)) {
      result.pricing = true
      result.documentation_only = false
      continue
    }

    if (GENERATED_PROVIDER_DOCUMENTS.has(path)) {
      result.providers = true
      result.documentation_only = false
      continue
    }

    if (PARSER_EXACT.has(path)) {
      result.parser = true
      result.documentation_only = false
      continue
    }

    if (path.startsWith('src/providers/') || path.startsWith('tests/providers/')) {
      result.providers = true
      result.documentation_only = false
      continue
    }

    if (
      LOCAL_STATE_EXACT.has(path) ||
      path.startsWith('src/local-state/') ||
      path.startsWith('src/vendor/')
    ) {
      result.local_state = true
      result.documentation_only = false
      continue
    }

    if (path.startsWith('src/pricing/')) {
      result.pricing = true
      result.documentation_only = false
      continue
    }

    if (path.startsWith('app/')) {
      result.desktop = true
      result.documentation_only = false
      continue
    }

    if (isDocumentationPath(path)) {
      continue
    }

    result.documentation_only = false
    result.fallback_core = true
    result.fallback_paths.push(path)
  }

  return result
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalJson(value[key])]),
    )
  }
  return value
}

function clone(value) {
  return structuredClone(value)
}

function hasCanonicalVersionCheckTransition(before, after) {
  const beforeCommand = before.scripts?.['version:check']
  const afterCommand = after.scripts?.['version:check']
  return afterCommand === VERSION_CHECK_COMMAND &&
    (beforeCommand === undefined || beforeCommand === VERSION_CHECK_COMMAND)
}

export function normalizeVersionOnlyDocument(path, input) {
  const value = clone(input)
  if (path === 'package.json') {
    delete value.version
    if (value.scripts) delete value.scripts['version:check']
  } else if (path === 'app/package.json') {
    delete value.version
    if (value.build) delete value.build.buildVersion
  } else if (path === 'package-lock.json' || path === 'app/package-lock.json') {
    delete value.version
    if (value.packages?.['']) delete value.packages[''].version
  }
  return canonicalJson(value)
}

export function isVersionOnlyPackageChange(path, before, after) {
  if (path === 'package.json' && !hasCanonicalVersionCheckTransition(before, after)) {
    return false
  }

  return JSON.stringify(normalizeVersionOnlyDocument(path, before)) ===
    JSON.stringify(normalizeVersionOnlyDocument(path, after))
}

export function applyPackageChangeRisk(result, path, before, after) {
  if (isVersionOnlyPackageChange(path, before, after)) return

  if (path.startsWith('app/')) result.desktop = true
  else result.fallback_core = true

  result.fallback_paths.push(`${path} (non-version package change)`)
}

function readJsonAt(ref, path) {
  return JSON.parse(execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' }))
}

function applyPackageRisk(base, result, changedPaths) {
  for (const path of changedPaths.filter(candidate => RELEASE_EXACT.has(candidate) && candidate.endsWith('.json'))) {
    try {
      const before = readJsonAt(base, path)
      const after = JSON.parse(readFileSync(path, 'utf8'))
      applyPackageChangeRisk(result, path, before, after)
    } catch (error) {
      result.fallback_core = true
      result.fallback_paths.push(`${path} (package comparison failed: ${error.message})`)
    }
  }
}

function changedPathsFrom(base) {
  return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .map(normalized)
    .filter(Boolean)
}

function writeGithubOutputs(result, changedPaths) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) throw new Error('GITHUB_OUTPUT is unavailable')

  const values = {
    parser: result.parser,
    providers: result.providers,
    local_state: result.local_state,
    pricing: result.pricing,
    desktop: result.desktop,
    release: result.release,
    powershell: result.powershell,
    fallback_core: result.fallback_core,
    documentation_only: result.documentation_only,
    changed_count: changedPaths.length,
  }

  appendFileSync(
    output,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
  )
}

function main() {
  const baseIndex = process.argv.indexOf('--base')
  if (baseIndex === -1 || !process.argv[baseIndex + 1]) {
    throw new Error('Usage: node scripts/draft-surface-classifier.mjs --base <sha>')
  }

  const base = process.argv[baseIndex + 1]
  let changedPaths = []
  let result

  try {
    changedPaths = changedPathsFrom(base)
    result = classifyDraftPaths(changedPaths)
    applyPackageRisk(base, result, changedPaths)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result = failClosedClassification(`change classification failed: ${message}`)
  }

  console.log(JSON.stringify({ changedPaths, ...result }, null, 2))
  writeGithubOutputs(result, changedPaths)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
