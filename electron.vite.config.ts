import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

// Pass ANALYZE=1 to a build to drop a treemap into out/bundle-stats.html.
// Useful for chasing down chunks like the 932 kB sonner one.
const analyze = !!process.env.ANALYZE

// 'unsafe-eval' is only needed by Vite HMR in dev. Strip it from CSP at build
// time so production renderers ship with a tighter script-src.
function tightenProdCsp(): {
  name: string
  apply: 'build'
  transformIndexHtml: (html: string) => string
} {
  return {
    name: 'tighten-prod-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/script-src 'self' 'unsafe-eval'/g, "script-src 'self'")
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      tightenProdCsp(),
      ...(analyze
        ? [
            visualizer({
              filename: 'out/bundle-stats.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              open: false
            })
          ]
        : [])
    ],
    build: {
      rollupOptions: {
        input: {
          dashboard: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          cropper: resolve('src/renderer/cropper.html'),
          chat: resolve('src/renderer/chat.html')
        }
      }
    }
  }
})
