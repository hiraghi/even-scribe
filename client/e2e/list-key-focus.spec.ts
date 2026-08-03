import { test, expect, screen } from './fixtures'

// Feature (2026-08-03, S-13): mobile WebViews only deliver hardware ARROW keys to the
// page when a *text* element is focused (a focused non-text div has its arrows reserved
// for native scrolling). The RECENT/file list therefore keeps a hidden #key-sink
// <textarea> focused so physical ↑/↓ reach the window handler. Verified end-to-end: on
// the list screen #key-sink is the active element and ArrowDown still moves the selection.
test('file list: hidden key-sink textarea is focused so physical arrow keys move the selection', async ({ appPage }) => {
  const page = appPage

  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('key-sink')

  const before = await screen(page)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => screen(page)).not.toBe(before)
  expect(await screen(page)).toMatch(/> /)
})
