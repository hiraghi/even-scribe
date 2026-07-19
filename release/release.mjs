#!/usr/bin/env node
// Even Scribe release helper: build -> pack (.ehpk) -> upload a Private build to the
// Even Hub developer portal, deterministically, with (near) zero LLM cost.
//
// The Even Hub CLI has no publish command (only login/init/pack/qr) and uploads go
// through the web dev portal, so this script drives the portal UI with Playwright
// using a persistent, pre-authenticated Chromium profile.
//
//   node release/release.mjs --login     # one-time: log into Even Hub in the profile
//   node release/release.mjs             # build + pack + upload the current version
//   node release/release.mjs --dry-run   # do everything up to (not incl.) "Add build"
//   node release/release.mjs --pack-only # build + pack only, no browser
//
// Flags: --no-build (skip the vite build, reuse dist/), --headed (watch the browser),
//        --changelog "text" (override the auto-extracted change log), --force
//        (upload even if that version already exists in Private builds).

import { chromium } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..') // even-scribe/
const CLIENT = join(ROOT, 'client')
const APP_JSON = join(CLIENT, 'app.json')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const EVENHUB_CLI = join(ROOT, 'node_modules/@evenrealities/evenhub-cli/main.js')
const PROFILE_DIR = join(HERE, '.auth-profile') // gitignored; holds the portal session
const PORTAL_BASE = 'https://hub.evenrealities.com/hub'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const LOGIN = has('--login')
const DRY = has('--dry-run')
const PACK_ONLY = has('--pack-only')
const HEADED = has('--headed') || LOGIN
const NO_BUILD = has('--no-build')
const FORCE = has('--force')
const changelogOverride = opt('--changelog')

const log = (...a) => console.log('[release]', ...a)
const die = (msg) => {
  console.error('[release] ERROR:', msg)
  process.exit(1)
}

function readManifest() {
  if (!existsSync(APP_JSON)) die(`app.json not found at ${APP_JSON}`)
  const m = JSON.parse(readFileSync(APP_JSON, 'utf8'))
  if (!m.version || !m.package_id) die('app.json is missing "version" or "package_id"')
  return m
}

// Pull the highlight paragraph directly under "## [<version>]" in CHANGELOG.md
// (the lines before the first "### " section). Returns '' if not found.
function extractChangelog(version) {
  if (!existsSync(CHANGELOG)) return ''
  const lines = readFileSync(CHANGELOG, 'utf8').split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim().startsWith(`## [${version}]`))
  if (start < 0) return ''
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.startsWith('## ') || t.startsWith('### ')) break
    if (t === '') {
      if (out.length) break // end of the highlight paragraph
      continue // skip the blank line right after the header
    }
    out.push(t.replace(/\\\s*$/, '')) // drop the trailing "\" hard-wrap marker
  }
  return out.join(' ').trim().slice(0, 500)
}

function run(cmd, cmdArgs, cwd, { shell = false } = {}) {
  log(`$ ${cmd} ${cmdArgs.join(' ')}  (in ${cwd})`)
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell })
  if (r.error) die(`could not run ${cmd}: ${r.error.message}`)
  if (r.status !== 0) die(`command failed (exit ${r.status}): ${cmd} ${cmdArgs.join(' ')}`)
}

function buildAndPack(version) {
  if (!NO_BUILD) {
    // shell:true so Windows can resolve/execute npm's .cmd shim (Node refuses to spawn
    // .cmd/.bat directly without a shell). Pass the whole command as one string so no
    // args reach the shell unescaped (avoids the DEP0190 warning).
    run('npm run build', [], CLIENT, { shell: true })
  }
  if (!existsSync(join(CLIENT, 'dist', 'index.html'))) {
    die('client/dist not found — run without --no-build, or build the client first')
  }
  const ehpkName = `even-scribe-${version}.ehpk`
  // Call the CLI's entry directly with node: the npm .bin shim is a bash script that
  // Node-on-Windows cannot execute, and this avoids depending on a global install.
  run(process.execPath, [EVENHUB_CLI, 'pack', 'app.json', 'dist', '-o', ehpkName], CLIENT)
  const ehpkPath = join(CLIENT, ehpkName)
  if (!existsSync(ehpkPath)) die(`pack did not produce ${ehpkPath}`)
  log(`packed ${ehpkName}`)
  return ehpkPath
}

async function withContext(fn) {
  let context
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1400, height: 900 },
    })
  } catch (e) {
    if (/Executable doesn.t exist|browserType.launch/i.test(String(e))) {
      die('Chromium for Playwright is not installed. Run: cd client && npm run e2e:install')
    }
    throw e
  }
  context.setDefaultTimeout(30000)
  const page = context.pages()[0] ?? (await context.newPage())
  try {
    return await fn(page, context)
  } finally {
    await context.close()
  }
}

async function doLogin(manifest) {
  log('Opening Even Hub. Log in in the browser window; this waits until you are in.')
  await withContext(async (page) => {
    const appUrl = `${PORTAL_BASE}/${manifest.package_id}`
    await page.goto(appUrl)
    // Poll for the app-page "Upload a build" button, which renders ONLY when
    // authenticated as the app owner (the "My projects" nav label shows even when
    // logged out, so it is not a reliable signal). Re-navigate to the app page if an
    // OAuth round-trip left us on a different URL.
    const deadline = Date.now() + 300000
    while (Date.now() < deadline) {
      if ((await page.getByRole('button', { name: /Upload a build/i }).count()) > 0) {
        log('Login detected — session saved to the profile. You can close this now.')
        return
      }
      await page.waitForTimeout(2000)
      if (!page.url().includes(manifest.package_id)) await page.goto(appUrl).catch(() => {})
    }
    die('Timed out waiting for login (5 min). Re-run `npm run release:login`.')
  })
  log('Done. Future runs can upload unattended.')
}

async function upload(manifest, ehpkPath, changelog) {
  if (!existsSync(PROFILE_DIR)) {
    die('No auth profile yet. Run `node release/release.mjs --login` once first.')
  }
  await withContext(async (page) => {
    await page.goto(`${PORTAL_BASE}/${manifest.package_id}`)

    const uploadBtn = page.getByRole('button', { name: /Upload a build/i })
    try {
      await uploadBtn.waitFor({ timeout: 15000 })
    } catch {
      die(
        'Not logged in (no "Upload a build" button). The session may have expired — ' +
          'run `node release/release.mjs --login` again.',
      )
    }

    // Guard against creating a duplicate build for a version already present.
    const existing = page.getByText(`v${manifest.version}`, { exact: false })
    if ((await existing.count()) > 0 && !FORCE && !DRY) {
      die(
        `v${manifest.version} already appears in Private builds. Bump the version, ` +
          'or pass --force to upload anyway.',
      )
    }

    await uploadBtn.click()

    // NEVER click the "Select file" button — that opens an OS file picker Playwright
    // cannot drive. Set the hidden <input type=file> value directly instead.
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(ehpkPath)

    // The dialog parses the .ehpk and shows the version it read from app.json.
    await page.getByText(`v${manifest.version}`, { exact: false }).first().waitFor()

    if (changelog) {
      const box = page
        .getByPlaceholder(/Describe what.s new/i)
        .or(page.locator('textarea'))
        .first()
      await box.fill(changelog)
      log(`change log set (${changelog.length} chars)`)
    } else {
      log('no change log found for this version — leaving it blank')
    }

    if (DRY) {
      log('dry-run: located everything, NOT clicking "Add build". Nothing was uploaded.')
      return
    }

    await page.getByRole('button', { name: /^Add build$/i }).click()

    // Verify: the dialog closes and the new version row shows up in Private builds.
    await page.getByRole('button', { name: /^Add build$/i }).waitFor({ state: 'detached' })
    await page.getByText(`v${manifest.version}`, { exact: false }).first().waitFor()
    log(`✔ uploaded v${manifest.version} as a Private build`)
  })
}

async function main() {
  const manifest = readManifest()
  log(`app ${manifest.package_id} — version ${manifest.version}`)

  if (LOGIN) return doLogin(manifest)

  const ehpkPath = buildAndPack(manifest.version)
  if (PACK_ONLY) {
    log(`pack-only: ${ehpkPath}`)
    return
  }

  const changelog = changelogOverride ?? extractChangelog(manifest.version)
  await upload(manifest, ehpkPath, changelog)
}

main().catch((e) => die(e?.stack || String(e)))
