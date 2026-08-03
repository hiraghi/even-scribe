import { test, expect, openNote } from './fixtures'

// Feature (2026-08-03): opening a note must land keyboard focus on the editor textarea
// so the physical keyboard can type immediately (no manual tap). This spec proves focus
// lands on the textarea in-app after opening, and that a DOM tap opens the exact item
// tapped. On mobile WebView, programmatic focus of a text input is gated behind user
// activation; the RECENT list keeping #file-list focused from startup (list-key-focus)
// establishes that activation early. The on-device first-open focus is confirmed
// manually (needs-runtime) — headless Chromium always focuses.
test('opening a note lands focus on the editor textarea', async ({ appPage }) => {
  const page = appPage

  const textarea = await openNote(page, 'ime.md')
  await expect(textarea).toBeVisible()

  // The textarea is the active element right after opening (no manual tap needed).
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
})

// A DOM tap on a non-selected list item must also open that exact item into a focused
// editor (single synchronous click(index) dispatch).
test('tapping a non-selected list item opens it with a focused editor', async ({ appPage }) => {
  const page = appPage
  await expect(page.locator('#screen')).toContainText('longnote')

  await page.locator('#file-list button[data-path="longnote.md"]').click()
  const textarea = page.locator('textarea:not(#key-sink)')
  await expect(textarea).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
  await expect(textarea).toHaveValue(/L01/)
})
