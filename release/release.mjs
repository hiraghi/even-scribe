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
//   node release/release.mjs --replace   # delete the existing same-version build, then upload
//                                        #   (the portal has no "edit change log" — this is how
//                                        #    you rewrite a change log for an already-uploaded build)
//
// Change log: by default the uploaded change log is CUMULATIVE — it concatenates the
// CHANGELOG.md highlight lines of every version newer than the newest build already on
// the portal, up to the current version (so a build that ships several bumps at once
// lists them all). In the normal cadence (upload right after one bump) that is just the
// current version's highlight. Override with --since/--single/--changelog.
//
// Auto-login: a normal upload run first checks the session headlessly; if it is missing
// or expired it opens a HEADED browser for you to log in by hand, then continues the same
// run (no separate `--login` step). Disable with --no-auto-login (old behaviour: fail and
// tell you to run --login).
//
// Flags: --no-build (skip the vite build, reuse dist/), --headed (watch the browser),
//        --no-auto-login (don't auto-open a login browser on an expired session),
//        --changelog "text" (override the auto-extracted change log), --force (upload
//        even if that version already exists — creates a duplicate row), --replace
//        (delete the existing same-version build first, then upload — use to rewrite a
//        change log), --since <ver> (accumulate the change log from versions newer than
//        <ver>), --single (change log = current version only, not cumulative).

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
const REPLACE = has('--replace')
const SINGLE = has('--single')
const AUTO_LOGIN = !has('--no-auto-login')
const sinceOverride = opt('--since')
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

// Parse CHANGELOG.md into ordered entries [{ version, highlight }] (file order = newest
// first). The "highlight" is the paragraph directly under "## [<version>]" — the lines
// before the first "### " section — with the trailing "\" hard-wrap markers dropped.
function parseChangelogEntries() {
  if (!existsSync(CHANGELOG)) return []
  const lines = readFileSync(CHANGELOG, 'utf8').split(/\r?\n/)
  const entries = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^##\s+\[(\d+\.\d+\.\d+)\]/)
    if (!m) continue
    const out = []
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim()
      if (t.startsWith('## ') || t.startsWith('### ')) break
      if (t === '') {
        if (out.length) break // end of the highlight paragraph
        continue // skip the blank line right after the header
      }
      out.push(t.replace(/\\\s*$/, ''))
    }
    entries.push({ version: m[1], highlight: out.join(' ').trim() })
  }
  return entries
}

// The highlight for a single version (''.slice keeps behaviour if absent).
function extractChangelog(version) {
  const entry = parseChangelogEntries().find((e) => e.version === version)
  return (entry?.highlight ?? '').slice(0, 500)
}

// Cumulative change log: highlights of every version strictly newer than `since` and up
// to (including) `current`, newest first, one per line. Falls back to the single current
// version if `since` is null/blank.
function cumulativeChangelog(since, current) {
  const entries = parseChangelogEntries()
  if (!since) return extractChangelog(current)
  const picked = entries.filter((e) => cmpVer(e.version, since) > 0 && cmpVer(e.version, current) <= 0 && e.highlight)
  return picked.map((e) => e.highlight).join('\n').slice(0, 1000)
}

// Numeric semver compare (major.minor.patch). Returns <0, 0, >0.
function cmpVer(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

// The highest version in `versions` that is strictly below `current`, or null.
function maxVersionBelow(versions, current) {
  const below = versions.filter((v) => cmpVer(v, current) < 0)
  if (below.length === 0) return null
  return below.reduce((hi, v) => (cmpVer(v, hi) > 0 ? v : hi))
}

// All x.y.z versions currently listed on the app page (Private builds rows).
async function versionsOnPortal(page) {
  const text = await page.locator('body').innerText().catch(() => '')
  return [...new Set([...text.matchAll(/v(\d+\.\d+\.\d+)/g)].map((m) => m[1]))]
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
    //
    // build:ehpk (not build): the default build targets GitHub Pages and emits absolute
    // "/even-scribe/assets/..." URLs. Inside the .ehpk the app is served from its own
    // root, so those 404 and the phone shows a blank dark screen. build:ehpk uses
    // --base=./ so the asset URLs are relative and work wherever the WebView mounts it.
    run('npm run build:ehpk', [], CLIENT, { shell: true })
  }
  const indexHtml = join(CLIENT, 'dist', 'index.html')
  if (!existsSync(indexHtml)) {
    die('client/dist not found — run without --no-build, or build the client first')
  }
  // Guard: never pack a Pages-based build (blank screen on device). Catches --no-build
  // reusing a dist/ left over from `npm run build` or the Pages workflow.
  const html = readFileSync(indexHtml, 'utf8')
  const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1])
  if (absolute.length > 0) {
    die(
      `dist/index.html references absolute paths (${absolute.join(', ')}) — that build is ` +
        'for GitHub Pages and renders blank inside the .ehpk. Rebuild with ' +
        '`npm run build:ehpk` (or drop --no-build).',
    )
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

async function withContext(fn, { headed = HEADED } = {}) {
  let context
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: !headed,
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

// Poll (on an already-open page) until the app-page "Upload a build" button appears —
// it renders ONLY when authenticated as the app owner (the "My projects" nav label shows
// even when logged out, so it is not a reliable signal). Returns true on success, false on
// timeout. While a login / OAuth form is on screen the user is typing into it, so we never
// re-navigate then (that wiped the half-filled form — "the page reloads every couple
// seconds and I can't type my email"); we only nudge back to the app page once the form is
// gone (e.g. an OAuth redirect left us on some other page with no button and no inputs).
async function waitForAuth(page, appUrl, manifest, deadlineMs = 300000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if ((await page.getByRole('button', { name: /Upload a build/i }).count()) > 0) return true
    await page.waitForTimeout(3000)
    const onLoginForm =
      (await page
        .locator(
          'input[type="password"], input[type="email"], input[name="email" i], input[autocomplete="username"], input[autocomplete="current-password"]',
        )
        .count()) > 0
    if (onLoginForm) continue
    if (!page.url().includes(manifest.package_id)) await page.goto(appUrl).catch(() => {})
  }
  return false
}

async function doLogin(manifest) {
  log('Opening Even Hub. Log in in the browser window; this waits until you are in.')
  await withContext(async (page) => {
    const appUrl = `${PORTAL_BASE}/${manifest.package_id}`
    await page.goto(appUrl)
    if (await waitForAuth(page, appUrl, manifest)) {
      log('Login detected — session saved to the profile. You can close this now.')
      return
    }
    die('Timed out waiting for login (5 min). Re-run `npm run release:login`.')
  })
  log('Done. Future runs can upload unattended.')
}

// Make sure a valid portal session exists before an unattended upload. Check headlessly
// first; if the session is missing or expired, open a HEADED window so the user can log in
// by hand, then continue the same run. Disable with --no-auto-login (restores the old
// behaviour: the upload just fails and tells you to run --login).
async function ensureLoggedIn(manifest) {
  const appUrl = `${PORTAL_BASE}/${manifest.package_id}`
  const authed = await withContext(
    async (page) => {
      await page.goto(appUrl)
      return page
        .getByRole('button', { name: /Upload a build/i })
        .waitFor({ timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    },
    { headed: false },
  )
  if (authed) return
  log('No valid Even Hub session — opening a browser to log in, then continuing the upload.')
  await withContext(
    async (page) => {
      await page.goto(appUrl)
      if (!(await waitForAuth(page, appUrl, manifest))) {
        die('Timed out waiting for login (5 min). Re-run after `npm run release:login`.')
      }
      log('Login detected — session saved. Continuing.')
    },
    { headed: true },
  )
}

// Delete an existing build for `version` via the Build details panel (Delete build ->
// Confirm). The portal exposes no change-log edit, so replacing a change log means
// deleting and re-uploading. Returns true if a build was deleted.
async function deleteBuild(page, version) {
  const row = page.getByText(new RegExp(`^v${version.replace(/\./g, '\\.')}$`)).first()
  if ((await row.count()) === 0) return false
  await row.click() // opens the Build details panel
  const del = page.getByRole('button', { name: /^Delete build$/i }).first()
  await del.waitFor({ timeout: 15000 })
  await del.click()
  await page.getByRole('button', { name: /^Confirm$/i }).click()
  // Wait until that version no longer appears in the list.
  await page
    .getByText(new RegExp(`^v${version.replace(/\./g, '\\.')}$`))
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => {})
  log(`deleted existing v${version}`)
  return true
}

async function upload(manifest, ehpkPath, changelogSpec) {
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
          're-run without --no-auto-login to log in automatically, or run ' +
          '`node release/release.mjs --login`.',
      )
    }

    // Snapshot the versions already on the portal — used both for the duplicate guard
    // and as the baseline for the cumulative change log. Wait for the Private builds
    // list to render first, otherwise older rows are missed and the change log baseline
    // is wrong.
    await page.getByText(/Private builds/i).first().waitFor({ timeout: 8000 }).catch(() => {})
    await page.getByText(/Uploaded/i).first().waitFor({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const portalVersions = await versionsOnPortal(page)
    const alreadyPresent = portalVersions.includes(manifest.version)

    if (alreadyPresent) {
      if (REPLACE && !DRY) {
        await deleteBuild(page, manifest.version)
      } else if (!FORCE && !DRY) {
        die(
          `v${manifest.version} already appears in Private builds. Pass --replace to ` +
            'delete it and re-upload (e.g. to rewrite the change log), --force to add a ' +
            'duplicate row, or bump the version.',
        )
      }
    }

    // Resolve the change log now that we know what is on the portal.
    let changelog = changelogSpec.override
    if (changelog == null) {
      const baseline = changelogSpec.since ?? (changelogSpec.single ? null : maxVersionBelow(portalVersions, manifest.version))
      changelog = baseline ? cumulativeChangelog(baseline, manifest.version) : extractChangelog(manifest.version)
      if (baseline) log(`change log accumulated since v${baseline}`)
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

  // Auto-recover an expired/missing session: open a headed login, then continue (unless
  // --no-auto-login). This runs before upload so a stale session no longer aborts the run.
  if (AUTO_LOGIN) await ensureLoggedIn(manifest)

  await upload(manifest, ehpkPath, {
    override: changelogOverride ?? null,
    since: sinceOverride ?? null,
    single: SINGLE,
  })
}

main().catch((e) => die(e?.stack || String(e)))
