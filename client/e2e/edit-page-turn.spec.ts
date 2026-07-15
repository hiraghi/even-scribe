import { test, expect, screen, ringScroll } from './fixtures'

// Feature (2026-07-15): in EDIT mode, glasses body / ring up-down scroll turns the
// page (viewport moves one screen) instead of moving the cursor. The cursor only
// moves via the physical keyboard arrows. Verified here through the real SDK event
// path (ring scroll) against the real app.
test('EDIT: ring scroll pages the viewport while the cursor stays put', async ({ appPage }) => {
  const page = appPage

  // RECENT -> longnote.md -> open into EDIT.
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('#screen')).toContainText('> longnote.md')
  await page.keyboard.press('Enter')
  await expect(page.locator('textarea')).toBeVisible()

  // Page 1: first lines visible, cursor at Ln 1 (wait for the content to render).
  await expect.poll(() => screen(page)).toContain('L01')
  const first = await screen(page)
  expect(first).toContain('Ln 1/20,Col 1')
  expect(first).not.toContain('L14')

  // Ring scroll down -> next page appears; the cursor line is UNCHANGED.
  await ringScroll(page, 'down')
  await expect.poll(() => screen(page)).toContain('L14')
  const paged = await screen(page)
  expect(paged).toContain('Ln 1/20,Col 1') // cursor did not move
  expect(paged).not.toContain('L01')

  // A second page down reaches the end of the note.
  await ringScroll(page, 'down')
  await expect.poll(() => screen(page)).toContain('L20')
  expect(await screen(page)).toContain('Ln 1/20,Col 1')

  // Ring scroll up pages back toward the top, cursor still put.
  await ringScroll(page, 'up')
  await expect.poll(() => screen(page)).not.toContain('L20')
  expect(await screen(page)).toContain('Ln 1/20,Col 1')
})
