// Copy the staged self-contained CLI (app/build/cli, produced by stage-cli.mjs)
// into the packaged app's resources/cli directory.
//
// The CLI runtime is dependency-bundled before this hook runs, so no loose
// node_modules tree is required in the packaged app. That is important for AppX:
// scoped npm directory names can be rewritten by the packaging layer, whereas a
// self-contained JS runtime has no scoped filesystem paths to resolve.

const { join } = require('node:path')
const { cpSync, existsSync } = require('node:fs')

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context
  const src = join(__dirname, '..', 'build', 'cli')
  if (!existsSync(join(src, 'dist', 'launch.js')) || !existsSync(join(src, 'dist', 'main.js'))) {
    throw new Error(`after-pack: ${src}/dist runtime is missing — run "npm run stage-cli" first`)
  }

  const resources =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(appOutDir, 'resources')
  const dest = join(resources, 'cli')

  cpSync(src, dest, { recursive: true, dereference: true })
  console.log(`after-pack: self-contained CLI copied -> ${dest}`)
}
