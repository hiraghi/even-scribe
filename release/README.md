# Even Scribe release helper

`release.mjs` does **build → pack (`.ehpk`) → upload a Private build** to the Even Hub
developer portal in one command, deterministically (near-zero LLM cost).

Why a browser script: the Even Hub CLI has **no publish command** (only
`login`/`init`/`pack`/`qr`) — uploads only happen through the web dev portal. So this
drives the portal UI with Playwright using a persistent, pre-authenticated Chromium
profile.

## One-time setup

```sh
cd client && npm run e2e:install   # installs Playwright's Chromium (once per machine)
cd ..    && npm run release:login  # opens Even Hub; log in — the session is saved
```

The login is stored in `release/.auth-profile/` (gitignored). Re-run `release:login`
if the session ever expires.

## Release the current version

Version and change log are read automatically from `client/app.json` and
`CHANGELOG.md` (the highlight paragraph under `## [x.y.z]`).

```sh
npm run release            # build + pack + upload v<app.json version> as a Private build
npm run release:check      # dry-run: do everything up to (not incl.) "Add build"
npm run release:pack       # build + pack only, no browser (produces client/even-scribe-<ver>.ehpk)
```

Useful flags (pass after `--`, e.g. `npm run release -- --headed`):

- `--headed` — watch the browser instead of running headless.
- `--no-build` — skip the vite build and reuse the existing `client/dist`.
- `--changelog "…"` — override the auto-extracted change log.
- `--force` — upload even if that version already appears in Private builds
  (normally the script refuses, to avoid duplicate builds — **bump the version first**).

After it prints `✔ uploaded v<ver>`, the build is Private. Promoting to testers /
public (Testing group → *Add a test user* → *Send invite*, or Store listing) is still
done by hand in the portal — those steps notify people, so they are intentionally not
automated.

## If the portal UI changes and selectors break

Fall back to the semi-automatic path: `npm run release:pack` to produce the `.ehpk`,
then have Claude (Chrome mode) upload it via the portal as it did the first time
(open the app page → *Upload a build* → drop the `.ehpk` → change log → *Add build*).
Then update the selectors in `release.mjs`.
