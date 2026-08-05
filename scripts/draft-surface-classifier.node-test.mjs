import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPackageChangeRisk,
  classifyDraftPaths,
  failClosedClassification,
  isVersionOnlyPackageChange,
} from './draft-surface-classifier.mjs'

const VERSION_CHECK_COMMAND = 'node scripts/check-version-consistency.mjs'

test('classifies known production families without fallback', () => {
  const result = classifyDraftPaths([
    'src/parser.ts',
    'src/providers/zed.ts',
    'src/local-state/signed-batch.ts',
    'src/pricing/historical-cost.ts',
    'app/src/main.ts',
    'scripts/Test-Metrora-Windows-Interrupted-Migration.ps1',
  ])

  assert.equal(result.parser, true)
  assert.equal(result.providers, true)
  assert.equal(result.local_state, true)
  assert.equal(result.pricing, true)
  assert.equal(result.desktop, true)
  assert.equal(result.release, true)
  assert.equal(result.powershell, true)
  assert.equal(result.fallback_core, false)
  assert.equal(result.documentation_only, false)
})

test('routes unknown non-document surfaces to the complete core fallback', () => {
  const result = classifyDraftPaths([
    'src/new-engine.ts',
    'tests/new-engine.test.ts',
    'tsconfig.json',
  ])

  assert.equal(result.fallback_core, true)
  assert.deepEqual(result.fallback_paths, [
    'src/new-engine.ts',
    'tests/new-engine.test.ts',
    'tsconfig.json',
  ])
})

test('allows ordinary documentation-only changes to remain cheap', () => {
  const result = classifyDraftPaths([
    'README.md',
    'docs/ARCHITECTURE.md',
    '.github/ISSUE_TEMPLATE/bug.md',
    'LICENSES/example/LICENSE.txt',
  ])

  assert.equal(result.documentation_only, true)
  assert.equal(result.fallback_core, false)
  assert.equal(result.release, false)
})

test('keeps generated documentation on its owning validation surfaces', () => {
  const result = classifyDraftPaths([
    'docs/PRICING_HISTORY.md',
    'docs/COLLECTOR_INVENTORY_V1.md',
  ])

  assert.equal(result.pricing, true)
  assert.equal(result.providers, true)
  assert.equal(result.documentation_only, false)
  assert.equal(result.fallback_core, false)
})

test('forces complete validation when change classification cannot be trusted', () => {
  const result = failClosedClassification('missing base commit')

  assert.equal(result.documentation_only, false)
  assert.equal(result.fallback_core, true)
  assert.deepEqual(result.fallback_paths, ['missing base commit'])
})

test('treats release guidance, workflows and script helpers as release surfaces', () => {
  const result = classifyDraftPaths([
    'CHANGELOG.md',
    '.github/workflows/windows-portable.yml',
    'scripts/windows-install-test-lib.ps1',
    'scripts/arbitrary-release-helper.mjs',
  ])

  assert.equal(result.release, true)
  assert.equal(result.powershell, true)
  assert.equal(result.fallback_core, false)
})

test('routes txt files outside explicit documentation surfaces to fallback', () => {
  const result = classifyDraftPaths([
    'src/runtime-policy.txt',
    'config/provider-rules.txt',
    'fixtures/production-input.txt',
  ])

  assert.equal(result.documentation_only, false)
  assert.equal(result.fallback_core, true)
  assert.deepEqual(result.fallback_paths, [
    'src/runtime-policy.txt',
    'config/provider-rules.txt',
    'fixtures/production-input.txt',
  ])
})

test('recognizes the canonical root version-check addition', () => {
  const before = {
    name: 'metrora',
    version: '0.9.19',
    scripts: { test: 'vitest' },
    dependencies: { zod: '1.0.0' },
  }
  const after = {
    name: 'metrora',
    version: '1.0.0-rc.1',
    scripts: { test: 'vitest', 'version:check': VERSION_CHECK_COMMAND },
    dependencies: { zod: '1.0.0' },
  }

  assert.equal(isVersionOnlyPackageChange('package.json', before, after), true)
})

test('rejects modification of the canonical version-check command', () => {
  const before = {
    version: '1.0.0-rc.1',
    scripts: { 'version:check': VERSION_CHECK_COMMAND },
  }
  const after = {
    version: '1.0.0-rc.2',
    scripts: { 'version:check': 'node scripts/unsafe-version-check.mjs' },
  }

  assert.equal(isVersionOnlyPackageChange('package.json', before, after), false)
})

test('rejects removal of the canonical version-check command', () => {
  const before = {
    version: '1.0.0-rc.1',
    scripts: { 'version:check': VERSION_CHECK_COMMAND },
  }
  const after = {
    version: '1.0.0-rc.2',
    scripts: {},
  }

  assert.equal(isVersionOnlyPackageChange('package.json', before, after), false)
})

test('rejects a non-canonical version-check addition', () => {
  const before = {
    version: '0.9.19',
    scripts: {},
  }
  const after = {
    version: '1.0.0-rc.1',
    scripts: { 'version:check': 'node check.mjs' },
  }

  assert.equal(isVersionOnlyPackageChange('package.json', before, after), false)
})

test('fails closed for dependency changes hidden beside a version bump', () => {
  const before = {
    name: 'metrora',
    version: '0.9.19',
    scripts: {},
    dependencies: { zod: '1.0.0' },
  }
  const after = {
    name: 'metrora',
    version: '1.0.0-rc.1',
    scripts: { 'version:check': VERSION_CHECK_COMMAND },
    dependencies: { zod: '2.0.0' },
  }

  assert.equal(isVersionOnlyPackageChange('package.json', before, after), false)
})

test('routes a non-version root package change to the core fallback', () => {
  const result = classifyDraftPaths(['package.json'])
  const before = {
    version: '1.0.0-rc.1',
    scripts: { 'version:check': VERSION_CHECK_COMMAND },
    dependencies: { zod: '1.0.0' },
  }
  const after = {
    version: '1.0.0-rc.2',
    scripts: { 'version:check': VERSION_CHECK_COMMAND },
    dependencies: { zod: '2.0.0' },
  }

  applyPackageChangeRisk(result, 'package.json', before, after)

  assert.equal(result.fallback_core, true)
  assert.equal(result.desktop, false)
  assert.deepEqual(result.fallback_paths, ['package.json (non-version package change)'])
})

test('recognizes only the permitted desktop build metadata change', () => {
  const before = {
    version: '0.9.19',
    build: { appId: 'eu.metrora.app' },
  }
  const after = {
    version: '1.0.0-rc.1',
    build: { appId: 'eu.metrora.app', buildVersion: '1.0.0.1' },
  }

  assert.equal(isVersionOnlyPackageChange('app/package.json', before, after), true)
})

test('routes a non-version desktop package change to desktop validation', () => {
  const result = classifyDraftPaths(['app/package.json'])
  const before = {
    version: '1.0.0-rc.1',
    build: { appId: 'eu.metrora.app', buildVersion: '1.0.0.1' },
    dependencies: { electron: '1.0.0' },
  }
  const after = {
    version: '1.0.0-rc.2',
    build: { appId: 'eu.metrora.app', buildVersion: '1.0.0.2' },
    dependencies: { electron: '2.0.0' },
  }

  applyPackageChangeRisk(result, 'app/package.json', before, after)

  assert.equal(result.desktop, true)
  assert.equal(result.fallback_core, false)
  assert.deepEqual(result.fallback_paths, ['app/package.json (non-version package change)'])
})
