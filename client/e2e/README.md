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

## Add a new acceptance test (smooth path)

1. Copy the template below into `e2e/<feature>.spec.ts`.
2. If you need extra notes, add them to `SEED` in `fixtures.ts` (seeded into IndexedDB
   before the app loads). Current seeds: `ime.md` (empty), `longnote.md` (20 lines).
3. Drive the app with `page.keyboard` (and `ringScroll` for glasses gestures); assert on
   the glasses screen or the editor.

```ts
import { test, expect, openNote, imeToggle, ringScroll, screen } from './fixtures'

test('<feature>: <expected user-visible behavior>', async ({ appPage }) => {
  const page = appPage

  // Open a seeded note into EDIT (returns the textarea). For LIST-mode tests,
  // assert on page.locator('#screen') directly instead.
  const textarea = await openNote(page, 'ime.md')

  // Keyboard editing / IME:
  await textarea.focus()
  await imeToggle(page)          // kana IME on
  await page.keyboard.type('kyou')
  await expect.poll(() => screen(page)).toContain('きょう')

  // Glasses ring/touch gesture (real SDK event path), e.g. page-turn in EDIT:
  await ringScroll(page, 'down')

  // Assert what the user sees:
  await expect.poll(() => screen(page)).toContain('...')   // glasses text
  // await expect(textarea).toHaveValue('...')             // committed editor content
})
```

### Helpers (`fixtures.ts`)

- `appPage` fixture — real client booted (mocked SDK bridge), IndexedDB seeded from
  `SEED`, Google IME lookup mocked (きょう → 今日); RECENT already loaded.
- `openNote(page, name)` — RECENT → select → open into EDIT; returns the textarea.
- `imeToggle(page)` — kana IME on/off (Ctrl+Space).
- `ringScroll(page, 'up'|'down')` — glasses ring/touch scroll via the real SDK event path.
- `screen(page)` — current glasses text (`#screen`, or the last glasses render in EDIT).

### Tips

- Glasses/render updates are async (debounced) — use `await expect.poll(() => screen(page))`.
- To assert an IME candidate, mock the reading in the `inputtools.google.com` route in
  `fixtures.ts` (currently only きょう is mapped).

Acceptance specs are the executable definition of "done": a feature is complete
only when its scenario here is green.
