import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    'desktop-local-state': 'src/desktop-local-state-entry.ts',
    'desktop-reviewed-production': 'src/desktop-reviewed-production-entry.ts',
  },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  // The desktop/Store runtime is copied into an Electron package and must be
  // self-contained. AppX rewrites `@scope` path segments in loose node_modules
  // trees, which makes Node resolution fail after packaging. Bundle every
  // production dependency into the emitted runtime instead; Node built-ins stay
  // external automatically. The public npm launcher still imports ./main.js.
  noExternal: [/.*/],
})
