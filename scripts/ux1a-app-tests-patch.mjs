import fs from 'node:fs'

const testPath = 'app/renderer/App.test.tsx'
const workflowPath = '.github/workflows/ux1a-app-tests-patch.yml'
const scriptPath = 'scripts/ux1a-app-tests-patch.mjs'
let source = fs.readFileSync(testPath, 'utf8')

function replaceOnce(from, to) {
  const first = source.indexOf(from)
  if (first < 0) throw new Error(`Expected App test fragment was not found: ${from.slice(0, 100)}`)
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`App test fragment was not unique: ${from.slice(0, 100)}`)
  source = source.replace(from, to)
}

replaceOnce(
  `  beforeEach(() => {
    installDefaultMocks()
    localStorage.clear()`,
  `  beforeEach(() => {
    installDefaultMocks()
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    localStorage.clear()`,
)

replaceOnce(
  "    expect(screen.getByText('⌘1-8')).toBeInTheDocument()",
  "    expect(screen.getByText('⌘1-9')).toBeInTheDocument()",
)

fs.writeFileSync(testPath, source)
fs.rmSync(workflowPath)
fs.rmSync(scriptPath)
