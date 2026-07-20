import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression (2026-07-20): the .ehpk shipped to Even Hub rendered a blank dark screen
// on the phone. `npm run build` targets GitHub Pages (base '/even-scribe/') and emits
// absolute "/even-scribe/assets/*.js" URLs; inside the package the WebView serves the
// app from some other root, so the bundle 404s and #app stays empty. `build:ehpk`
// builds with --base=./ instead. This spec builds the package artifact and boots it
// from a NON-root mount path — the condition that broke on device.
const CLIENT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(CLIENT, 'dist')
const MOUNT = '/hub/app/whatever/'
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
}

function serveDistAt(mount: string): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (!path.startsWith(mount)) {
      // Anything outside the mount is unreachable, exactly as on device.
      res.writeHead(404).end('outside mount')
      return
    }
    const file = join(DIST, path.slice(mount.length) || 'index.html')
    if (!existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({ server, base: `http://127.0.0.1:${port}${mount}` })
    })
  })
}

test('packaged build boots from a non-root mount path (.ehpk blank-screen guard)', async ({
  page,
}) => {
  test.slow() // includes a full tsc + vite build
  const build = spawnSync('npm run build:ehpk', { cwd: CLIENT, shell: true, encoding: 'utf8' })
  expect(build.status, `build:ehpk failed:\n${build.stdout}\n${build.stderr}`).toBe(0)

  // No absolute asset URLs may survive into the packaged index.html.
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  expect(html.match(/(?:src|href)="\/[^"]*"/g) ?? []).toEqual([])

  const { server, base } = await serveDistAt(MOUNT)
  try {
    const broken: string[] = []
    page.on('requestfailed', (r) => broken.push(r.url()))
    page.on('response', (r) => {
      if (r.status() >= 400) broken.push(`${r.status()} ${r.url()}`)
    })

    await page.goto(base)

    // The real app rendered: #app has content and the settings screen is up.
    await expect(page.locator('#ime-conv-style')).toBeVisible({ timeout: 10_000 })
    expect(broken, 'assets failed to load from the mount path').toEqual([])
  } finally {
    server.close()
  }
})
