import { test, expect, openNote } from './fixtures'

// Feature (2026-08-03, S-14): a stray tap on a passive area (e.g. the #screen mirror) can
// pull focus off the key-receiving element, after which physical keys stop reaching the
// page. A document-level pointerdown re-asserts focus onto the current mode's key element
// (list -> #key-sink, edit -> editor textarea) so keys keep flowing. Desktop Chromium
// cannot reproduce the mobile activation gate, so this verifies the refocus LOGIC.

test('tapping a passive area re-focuses the key-sink in the file list', async ({ appPage }) => {
  const page = appPage
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('key-sink')

  // Simulate focus being pulled away, then a tap on the passive #screen mirror.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).not.toBe('key-sink')

  await page.locator('#screen').dispatchEvent('pointerdown')
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('key-sink')
})

test('tapping a passive area re-focuses the editor textarea while editing', async ({ appPage }) => {
  const page = appPage
  const textarea = await openNote(page, 'ime.md')
  await expect(textarea).toBeFocused()

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect(textarea).not.toBeFocused()

  // #app (appRoot) is a passive <div> present in every mode; #screen is REMOVED in edit
  // mode (mountEditor clears the container), so dispatch on #app, not #screen.
  await page.locator('#app').dispatchEvent('pointerdown')
  await expect(textarea).toBeFocused()
})
