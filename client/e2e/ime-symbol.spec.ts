import { test, expect, screen, openNote, imeToggle } from './fixtures'

// Fix (2026-07-14): typing symbols right after hiragana no longer breaks
// conversion. The trailing symbols are folded into the composing unit; Space
// converts only the kana prefix and keeps the symbols; confirming the kana leaves
// a symbol-only remainder pending. Verified end-to-end through the real app
// (real jp-ime) with the Google candidate lookup mocked to きょう -> 今日.
test('IME: symbols after hiragana keep conversion intact (きょう！？ -> 今日！？)', async ({ appPage }) => {
  const page = appPage

  // RECENT -> ime.md (the empty note) -> open into EDIT.
  const textarea = await openNote(page, 'ime.md')
  await textarea.focus()

  // Turn kana IME on, then type hiragana followed by symbols.
  await imeToggle(page)
  await page.keyboard.type('kyou')
  await expect.poll(() => screen(page)).toContain('きょう')

  await page.keyboard.type('!')
  await page.keyboard.type('?')
  // Symbols are folded into the ONE composing unit (not committed yet).
  await expect.poll(() => screen(page)).toContain('きょう！？')
  expect(await textarea.inputValue()).toBe('')

  // Space converts only the kana prefix; the trailing symbols are kept and the
  // candidate list appears (conversion was NOT broken by the symbols).
  await page.keyboard.press('Space')
  await expect.poll(() => screen(page)).toContain('今日')
  const converting = await screen(page)
  expect(converting).toContain('！？') // symbols retained alongside the candidate

  // Confirm the kana -> commits 今日, leaving ！？ pending; a second Enter commits it.
  await page.keyboard.press('Enter')
  await expect.poll(() => textarea.inputValue()).toContain('今日')
  await page.keyboard.press('Enter')

  await expect(textarea).toHaveValue('今日！？')
})
