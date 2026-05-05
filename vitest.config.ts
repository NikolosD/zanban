import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Default node environment so most tests are pure-fn quick. Renderer-side
 * tests that need a DOM should declare `// @vitest-environment happy-dom` at
 * the top of the file.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false
  },
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  }
})
