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
})
