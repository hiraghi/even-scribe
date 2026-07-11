import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@eveng2/jp-ime': fileURLToPath(new URL('../jp-ime/src/index.ts', import.meta.url)),
    },
  },
  test: { environment: 'jsdom' },
})
