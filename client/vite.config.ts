import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/even-scribe/',
  server: { host: true, port: 5175 },
  build: { target: 'esnext' },
  resolve: {
    alias: {
      '@eveng2/jp-ime': fileURLToPath(new URL('../packages/jp-ime/src/index.ts', import.meta.url)),
      '@eveng2/g2-core': fileURLToPath(new URL('../packages/g2-core/src/index.ts', import.meta.url)),
    },
  },
  test: { environment: 'jsdom' },
})
