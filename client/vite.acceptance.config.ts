import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Acceptance build: same as the dev app (base '/'), with the native-host SDK
// boundary aliased to an in-browser mock so main.ts can boot headlessly. Storage
// (IndexedDB) works natively in the browser, so nothing else is stubbed here.
export default defineConfig({
  base: '/',
  server: { host: '127.0.0.1', port: 5179 },
  build: { target: 'esnext' },
  resolve: {
    alias: {
      '@eveng2/jp-ime': fileURLToPath(new URL('../packages/jp-ime/src/index.ts', import.meta.url)),
      '@eveng2/g2-core': fileURLToPath(new URL('../packages/g2-core/src/index.ts', import.meta.url)),
      '@evenrealities/even_hub_sdk': fileURLToPath(
        new URL('./e2e/mocks/even_hub_sdk.ts', import.meta.url),
      ),
    },
  },
})
