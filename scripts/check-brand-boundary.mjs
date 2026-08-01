import { execFileSync } from 'node:child_process'

const allowedExact = new Set([
  'README.md',
  'package.json',
  'package-lock.json',
  'docs/TECHNICAL_IDENTITY_COMPATIBILITY.md',
  'scripts/check-brand-boundary.mjs',
  'app/electron/cli-identity.test.ts',
  'app/electron/cli.ts',
  'app/electron/identity.test.ts',
  'app/electron/identity.ts',
  'app/electron/ipc-identity.test.ts',
  'app/electron/local-state.test.ts',
  'app/electron/local-state.ts',
  'app/electron/main.ts',
  'app/electron/preload.ts',
  'app/renderer/lib/ipc.ts',
  'app/renderer/lib/storage.test.ts',
  'app/renderer/lib/storage.ts',
  'android/app/src/main/kotlin/eu/metrora/app/network/Protocol.kt',
  'android/app/src/test/kotlin/eu/metrora/app/network/ProtocolTest.kt',
  'src/pricing/local-observation-ledger.ts',
  'src/providers/collector-inventory.ts',
  'src/technical-identity.test.ts',
])
const allowedPrefixes = ['src/contracts/v1/', 'src/local-state/']

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const badPaths = files.filter(path => /qovrion/i.test(path))
const output = execFileSync('git', ['grep', '-n', '-I', '-i', '-E', 'qovrion|QOVRION', '--', '.'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
})
const violations = output.trim().split('\n').filter(Boolean).filter(line => {
  const path = line.slice(0, line.indexOf(':'))
  return !allowedExact.has(path) && !allowedPrefixes.some(prefix => path.startsWith(prefix))
})

if (badPaths.length || violations.length) {
  if (badPaths.length) console.error(`Legacy name found in tracked paths:\n${badPaths.join('\n')}`)
  if (violations.length) console.error(`Legacy name escaped the compatibility boundary:\n${violations.join('\n')}`)
  process.exit(1)
}
console.log('Metrora brand boundary is clean; Qovrion remains only in explicit compatibility/provenance files.')
