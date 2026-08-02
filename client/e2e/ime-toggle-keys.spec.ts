import { test, expect, screen, openNote } from './fixtures'

// Feature (2026-08-02): kana IME ON/OFF now has extra shortcuts besides Ctrl+Space
// (which some OS IME/input-source switchers swallow): Shift+Space, F9, and Ctrl+J.
// Each is verified end-to-end through the real app: pressing it once turns kana IME
// on (romaji "kyou" -> きょう appears on the glasses screen), pressing it again turns
// it off (romaji is typed literally into the textarea instead).
for (const { label, press } of [
  { label: 'Shift+Space', press: 'Shift+Space' },
  { label: 'F9', press: 'F9' },
  { label: 'Ctrl+J', press: 'Control+j' },
] as const) {
  test(`IME: ${label} toggles kana input on and off`, async ({ appPage }) => {
    const page = appPage

    const textarea = await openNote(page, 'ime.md')
    await textarea.focus()

    // First press -> kana IME ON: romaji composes into hiragana on the screen.
    await page.keyboard.press(press)
    await page.keyboard.type('kyou')
    await expect.poll(() => screen(page)).toContain('きょう')
    expect(await textarea.inputValue()).toBe('')

    // Clear the pending composition so the next phase starts clean.
    await page.keyboard.press('Escape')

    // Second press -> kana IME OFF: romaji is inserted literally into the textarea.
    await page.keyboard.press(press)
    await page.keyboard.type('abc')
    await expect(textarea).toHaveValue('abc')
  })
}
