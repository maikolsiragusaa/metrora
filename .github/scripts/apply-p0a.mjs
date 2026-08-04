import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const current = await readFile(path, 'utf8')
  const first = current.indexOf(before)
  if (first < 0) throw new Error(`Expected text not found in ${path}`)
  if (current.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected text is not unique in ${path}`)
  }
  await writeFile(path, current.slice(0, first) + after + current.slice(first + before.length), 'utf8')
}

await replaceOnce(
  'tests/parser.test.ts',
  `  const lines = [
    JSON.stringify({ type: 'session.model_change', timestamp: '2026-05-01T10:00:00Z', data: { newModel: 'gpt-4.1' } }),
    JSON.stringify({ type: 'user.message', timestamp: '2026-05-01T10:00:05Z', data: { content: 'hello', interactionId: 'int-1' } }),
    JSON.stringify({ type: 'assistant.message', timestamp: '2026-05-01T10:00:10Z', data: { messageId: 'msg-1', outputTokens, interactionId: 'int-1', toolRequests: [] } }),
  ]`,
  `  const nowMs = Date.now()
  const modelTimestamp = new Date(nowMs - 11_000).toISOString()
  const userTimestamp = new Date(nowMs - 6_000).toISOString()
  const assistantTimestamp = new Date(nowMs - 1_000).toISOString()
  const lines = [
    JSON.stringify({ type: 'session.model_change', timestamp: modelTimestamp, data: { newModel: 'gpt-4.1' } }),
    JSON.stringify({ type: 'user.message', timestamp: userTimestamp, data: { content: 'hello', interactionId: 'int-1' } }),
    JSON.stringify({ type: 'assistant.message', timestamp: assistantTimestamp, data: { messageId: 'msg-1', outputTokens, interactionId: 'int-1', toolRequests: [] } }),
  ]`,
)

await replaceOnce(
  'tests/parser-incremental-append.test.ts',
  `import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, stat, unlink } from 'fs/promises'`,
  `import { mkdtemp, mkdir, writeFile, appendFile, readFile, rename, rm, stat, unlink } from 'fs/promises'`,
)

await replaceOnce(
  'tests/parser-incremental-append.test.ts',
  `    const inoBefore = (await stat(sessionPath)).ino

    // Replace the file (new inode) with different, LARGER content.
    await unlink(sessionPath)
    const replaced = [
      ...baseLines(),
      userLine('2026-05-01T12:00:00.000Z', 'brand new task'),
      asstLine('msg-z', '2026-05-01T12:00:02.000Z', { input_tokens: 500, output_tokens: 120 }, [readBlock('/z.ts')]),
    ].join('\\n') + '\\n'
    await writeFile(sessionPath, replaced)
    expect((await stat(sessionPath)).ino).not.toBe(inoBefore)`,
  `    const originalIdentity = await stat(sessionPath)

    // Create the replacement while the original still exists so the two file
    // identities cannot be reused, then atomically rename it over the source.
    const replacementPath = join(projectDir, 'sess-1.replacement.jsonl')
    const replaced = [
      ...baseLines(),
      userLine('2026-05-01T12:00:00.000Z', 'brand new task'),
      asstLine('msg-z', '2026-05-01T12:00:02.000Z', { input_tokens: 500, output_tokens: 120 }, [readBlock('/z.ts')]),
    ].join('\\n') + '\\n'
    await writeFile(replacementPath, replaced)
    const replacementIdentity = await stat(replacementPath)
    expect([replacementIdentity.dev, replacementIdentity.ino])
      .not.toEqual([originalIdentity.dev, originalIdentity.ino])
    await rename(replacementPath, sessionPath)`,
)

await replaceOnce(
  'tests/cli-durable-totals.test.ts',
  `  const now = new Date()
  const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).toISOString()
  const ts2 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30, 0).toISOString()`,
  `  const nowMs = Date.now()
  const now = new Date(nowMs)
  const localMidnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const ts = new Date(Math.max(localMidnightMs, nowMs - 60_000)).toISOString()
  const ts2 = new Date(Math.max(localMidnightMs, nowMs - 1_000)).toISOString()`,
)

await writeFile(
  'docs/TEST_QUARANTINE.md',
  `# Core test quarantine

Metrora treats the complete core and desktop suites as blocking merge gates. A test may be quarantined only when it is named exactly, the underlying behavior is outside the current bounded change, and an explicit exit condition is recorded here.

Quarantine is not equivalent to deletion or success. CI continues to execute every non-quarantined test in the affected files and reports quarantined cases separately.

## Active cases

None.

Four previously quarantined parser and durable-cache cases now use clock-independent and filesystem-portable fixtures. The provider-filter parity case was caused by a live-day fixture whose fixed noon timestamps could lie in the future when CI ran before noon; corrected fixtures did not establish a production aggregation defect.

## Rules

- No wildcard quarantine.
- No provider, platform or directory may be excluded without executing its non-quarantined tests separately.
- New failures cannot be added here merely to merge a feature.
- Every active entry must be removed in the first bounded tranche that owns its underlying subsystem.
`,
  'utf8',
)

const ciPath = '.github/workflows/ci.yml'
let ci = await readFile(ciPath, 'utf8')
ci = ci.replace(
  `  pull_request:\n`,
  `  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]\n`,
)
ci = ci.replace(
  `  build:\n    name: Core and desktop validation`,
  `  targeted-draft:\n    name: Targeted draft validation\n    if: github.event_name == 'pull_request' && github.event.pull_request.draft == true\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22.15.0'\n          cache: npm\n      - name: Validate runtime compression support\n        run: node -e \"if (typeof require('node:zlib').zstdDecompressSync !== 'function') throw new Error('Required runtime compression support is unavailable')\"\n      - name: Install dependencies\n        run: npm ci --no-audit --no-fund\n      - name: Validate generated pricing documentation\n        run: npm run pricing:docs:check\n      - name: Build product runtime\n        run: npm run build:cli\n      - name: Run affected parser and durable-cache tests\n        run: >-\n          npm test -- --run --no-file-parallelism\n          tests/parser.test.ts\n          tests/parser-incremental-append.test.ts\n          tests/cli-durable-totals.test.ts\n\n  build:\n    if: github.event_name == 'push' || github.event.pull_request.draft == false\n    name: Core and desktop validation`,
)
ci = ci.replace(
  `  full-suite:\n    name: Core test suite`,
  `  full-suite:\n    if: github.event_name == 'push' || github.event.pull_request.draft == false\n    name: Core test suite`,
)
const quarantineBlock = /      - name: Run ordinary core files deterministically[\s\S]*?      - name: Record validation outcome/
if (!quarantineBlock.test(ci)) throw new Error('CI quarantine block not found')
ci = ci.replace(
  quarantineBlock,
  `      - name: Run complete core suite deterministically\n        run: npm test -- --run --no-file-parallelism --exclude 'app/**'\n      - name: Record validation outcome`,
)
ci = ci.replace(
  `            echo \"Required core and platform-specific validation completed.\"`,
  `            echo \"The complete core suite and required platform-specific validation completed without quarantined cases.\"`,
)
await writeFile(ciPath, ci, 'utf8')
