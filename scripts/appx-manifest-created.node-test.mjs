import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const hook = require(fileURLToPath(new URL('../app/scripts/appx-manifest-created.cjs', import.meta.url)))
const applyStorePackageVersion = hook.applyStorePackageVersion
const authority = {
  schemaVersion: 1,
  publishedStorePackageVersion: '1.0.0.0',
  candidateStorePackageVersion: '1.0.1.0',
}

function manifest(overrides = '') {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="Vensent.Metrora" Publisher="CN=BC955F81-5099-4C27-A7A6-FF611BAACC3F" Version="1.0.0.0" ProcessorArchitecture="x64"${overrides ? ` ${overrides}` : ''} />
  <Properties><DisplayName>Metrora</DisplayName></Properties>
</Package>
`
}

test('applies only the candidate Store version to the structurally reviewed Identity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-appx-hook-'))
  const path = join(directory, 'AppxManifest.xml')
  const original = manifest('ResourceGroup="unchanged"')
  writeFileSync(path, original)

  await hook.default(path)

  const transformed = readFileSync(path, 'utf8')
  assert.match(transformed, /Version="1\.0\.1\.0"/)
  assert.match(transformed, /ResourceGroup="unchanged"/)
  assert.equal(transformed, original.replace('Version="1.0.0.0"', 'Version="1.0.1.0"'))
})

test('rejects a generated manifest whose Store identity baseline is unexpected', () => {
  assert.throws(
    () => applyStorePackageVersion(manifest().replace('Version="1.0.0.0"', 'Version="1.0.0.9"'), authority),
    /published Store baseline/,
  )
})

test('rejects wrong identity, missing identity and ambiguous Identity shapes', () => {
  assert.throws(
    () => applyStorePackageVersion(manifest().replace('Name="Vensent.Metrora"', 'Name="Other.Package"'), authority),
    /Identity Name/,
  )
  assert.throws(
    () => applyStorePackageVersion(manifest().replace(/\n  <Identity[^\n]+\n/, '\n'), authority),
    /exactly one direct Package\/Identity/,
  )
  assert.throws(
    () => applyStorePackageVersion(manifest() + manifest().replace('<Package ', '<Package '), authority),
    /malformed|exactly one direct Package\/Identity|AppX manifest root/,
  )
})

test('rejects malformed XML and ambiguous Version attributes', () => {
  assert.throws(() => applyStorePackageVersion('<Package>', authority), /malformed|root/)
  assert.throws(
    () => applyStorePackageVersion(manifest('Version="1.0.0.0"'), authority),
    /malformed|Version attribute shape is ambiguous/,
  )
})
