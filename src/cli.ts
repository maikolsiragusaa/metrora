#!/usr/bin/env node
// This launcher must stay parseable by Node 18. Do NOT add static imports.
// Electron-as-Node inserts an extra argv entry before the script path. The
// packaged launch shim removes it for Commander; keep the repo/dev launcher
// equivalent so Windows Vite development sees the same CLI argv shape.
if (process.versions.electron) process.argv.splice(1, 1)

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(
    `Metrora requires Node.js >= 22.13.0 (current: ${process.version})\n` +
    'Upgrade at https://nodejs.org/\n',
  )
  process.exit(1)
}

async function launch() {
  // `--version` is a metadata-only request. Keep it ahead of the Commander
  // graph so a one-line health check does not load the full CLI bundle.
  if (process.argv[2] === '--version' || process.argv[2] === '-V') {
    const { readFile } = await import('node:fs/promises')
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    process.stdout.write(`${typeof packageJson.version === 'string' ? packageJson.version : ''}\n`)
    return
  }
  await import('./main.js')
}

launch().catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n')
  process.exit(1)
})
