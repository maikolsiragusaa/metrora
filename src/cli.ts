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

import('./main.js').catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n')
  process.exit(1)
})