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

// S-13 (0.6.2): on device the WebView eats hardware ARROW keys in the list (spatial
// navigation), but letters ARE delivered, so j/k (vim-style: j=down, k=up) drive the
// selection as a reliable alternative to the arrows.
test('file list: j moves the selection down and k moves it back up', async ({ appPage }) => {
  const page = appPage

  const start = await screen(page)
  await page.keyboard.press('j')
  await expect.poll(() => screen(page)).not.toBe(start)
  const afterDown = await screen(page)

  await page.keyboard.press('k')
  await expect.poll(() => screen(page)).toBe(start) // back to the original selection
  expect(afterDown).not.toBe(start)
})
