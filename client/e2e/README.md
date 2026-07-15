# Acceptance harness ("does it actually work")

These tests boot the **real Even Scribe client through `main.ts`** in a headless
browser and drive it like a user, asserting on the glasses screen (`#screen`) and
the editor. They catch "reported done but doesn't actually run" gaps that the
isolated-module unit tests in `test/` skip.

## Run

```sh
npm run e2e            # headless; writes e2e-results.json (machine-readable)
npm run e2e:install    # one-time: download the Chromium binary
```

`npm run e2e` starts a Vite dev server via `vite.acceptance.config.ts` (identical
to the app except the native-host SDK boundary `@evenrealities/even_hub_sdk` is
aliased to `e2e/mocks/even_hub_sdk.ts`). Storage is real IndexedDB; the only mock
is the Google IME candidate lookup (`page.route` in `fixtures.ts`).

## How it works

- **`e2e/mocks/even_hub_sdk.ts`** — minimal in-browser stand-in for the native
  bridge. Lets a test push touchpad/ring events via `window.__emitEvenHubEvent`
  and records the last glasses text in `window.__lastGlassesText`.
- **`e2e/fixtures.ts`** — seeds notes into IndexedDB (DB `even-scribe`, store
  `notes`) and mocks the Google inputtools lookup (きょう → 今日). Exposes
  `screen()` (glasses text) and `ringScroll(page, 'up'|'down')` (ring gesture via
  the real SDK event path).

## Covered features

- **`edit-page-turn.spec.ts`** — ring up/down scroll pages the EDIT viewport while
  the cursor stays put (feat 2026-07-15).
- **`ime-symbol.spec.ts`** — symbols typed after hiragana keep conversion intact:
  きょう！？ → 今日！？ (fix 2026-07-14).

Acceptance specs are the executable definition of "done": a feature is complete
only when its scenario here is green.
