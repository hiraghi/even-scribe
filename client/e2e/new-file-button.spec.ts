import { test, expect, screen } from './fixtures'

// Feature (2026-07-19): a visible "New file" button in the shell toolbar, restored
// from the original release UI. Clicking it opens the same name-input dialog as the
// Ctrl+N keybinding (startNameInput('new-file')); submitting a name creates an empty
// note that shows up in RECENT. Verified here through the real app.
test('New file button: opens the name dialog and creates a note', async ({ appPage }) => {
  const page = appPage

  const button = page.locator('#new-file-button')
  await expect(button).toBeVisible()

  // Click -> name-input dialog (single-line editor with the "New file name" prompt).
  await button.click()
  const textarea = page.locator('textarea')
  await expect(textarea).toBeVisible()
  await expect.poll(() => screen(page)).toContain('New file name')

  // Type a name and submit (Enter -> submitNameInput -> createNote).
  await textarea.fill('button-note')
  await page.keyboard.press('Enter')

  // Back in RECENT, the new note is listed.
  await expect(page.locator('#screen')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => screen(page)).toContain('button-note')
})
