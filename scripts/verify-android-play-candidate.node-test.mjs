import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readRepositoryFile = relativePath =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

test('Play candidate verifier remains source-bound and reuses release evidence primitives', () => {
  const verifier = readRepositoryFile('scripts/verify-android-play-candidate.mjs')
  const workflow = readRepositoryFile('.github/workflows/android-play-candidate.yml')

  assert.match(verifier, /verifyPlayCandidateBundle/)
  assert.match(verifier, /distributionChannel: ANDROID_PLAY_DISTRIBUTION_CHANNEL/)
  assert.match(verifier, /SHA256SUMS/)
  assert.match(workflow, /workflow_dispatch/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /no Google Play upload or production submission was performed/)
  assert.match(workflow, /bundletool_version='1\.18\.1'/)
  assert.match(workflow, /expected_bundletool_sha256='675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c'/)
  assert.match(workflow, /actual_bundletool_sha256=.*sha256sum/)
  assert.match(workflow, /actual_bundletool_sha256.*expected_bundletool_sha256/)
  assert.ok(workflow.indexOf('actual_bundletool_sha256') < workflow.indexOf('node scripts/verify-android-play-candidate.mjs'))
})
