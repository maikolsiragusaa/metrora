import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    'desktop-local-state': 'src/desktop-local-state-entry.ts',
    'desktop-reviewed-production': 'src/desktop-reviewed-production-entry.ts',
    'desktop-share-runtime': 'src/desktop-share-runtime-entry.ts',
    'act-desktop-bridge': 'src/act/desktop-bridge.ts',
  },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  external: ['@modelcontextprotocol/sdk', 'zod'],
})
