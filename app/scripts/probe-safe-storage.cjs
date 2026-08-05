const { app, safeStorage } = require('electron')
const { mkdtemp, mkdir, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

async function main() {
  if (process.platform !== 'win32') throw new Error('safeStorage probe is Windows-only')
  const root = await mkdtemp(join(tmpdir(), 'metrora-electron-vault-'))
  const userData = join(root, 'user-data')
  await mkdir(userData, { recursive: true })
  app.setPath('userData', userData)

  try {
    await app.whenReady()
    const runtimePath = join(__dirname, '..', '..', 'dist', 'desktop-local-state.js')
    const runtime = await import(pathToFileURL(runtimePath).href)
    const provider = {
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: plaintext => safeStorage.encryptStringAsync(plaintext),
      decryptString: ciphertext => safeStorage.decryptStringAsync(Buffer.from(ciphertext)),
    }
    const options = {
      backend: 'windows-dpapi',
      dataDir: join(root, 'state'),
      safeStorage: provider,
    }
    const first = await runtime.initializeDesktopLocalStateV1(options)
    const second = await runtime.initializeDesktopLocalStateV1(options)
    if (first.masterKeyState !== 'created') throw new Error(`expected created master key, got ${first.masterKeyState}`)
    if (second.masterKeyState !== 'loaded') throw new Error(`expected loaded master key, got ${second.masterKeyState}`)
    if (first.endpoint.endpointId !== second.endpoint.endpointId) throw new Error('endpoint identity changed across DPAPI reload')
    if (first.endpoint.publicKeyFingerprintSha256 !== second.endpoint.publicKeyFingerprintSha256) {
      throw new Error('endpoint signing key changed across DPAPI reload')
    }
    process.stdout.write(`safeStorage probe passed for ${first.endpoint.endpointId}\n`)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
    app.quit()
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  app.quit()
  process.exitCode = 1
})
