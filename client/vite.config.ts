import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Production build is served from GitHub Pages under /even-scribe/, but the local
// emulator / dev server (and the EvenHub simulator) loads the app from the root URL.
// So only apply the Pages base when building; dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/even-scribe/' : '/',
  server: { host: true, port: 5175 },
  build: { target: 'esnext' },
  resolve: {
    alias: {
      '@eveng2/jp-ime': fileURLToPath(new URL('../packages/jp-ime/src/index.ts', import.meta.url)),
      '@eveng2/g2-core': fileURLToPath(new URL('../packages/g2-core/src/index.ts', import.meta.url)),
    },
  },
  test: { environment: 'jsdom' },
}))
