import { test, expect, screen } from './fixtures'

// Feature (2026-08-03): mobile WebView does not deliver hardware-keyboard keydown
// to the page unless some element is focused. The RECENT/file list now keeps its
// #file-list container focused (tabindex=-1) so physical ↑/↓ reach the window
// handler. Verified end-to-end: on the list screen #file-list is the active
// element, and ArrowDown still moves the selection (focus must not break nav).
test('file list: container is focused so physical arrow keys move the selection', async ({ appPage }) => {
  const page = appPage

  // On the RECENT list, the #file-list container holds focus.
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('file-list')

  // ArrowDown still moves the selection marker (focus on the container must not
  // trip the textTarget guard or the native scroll).
  const before = await screen(page)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => screen(page)).not.toBe(before)
  expect(await screen(page)).toMatch(/> /)
})
