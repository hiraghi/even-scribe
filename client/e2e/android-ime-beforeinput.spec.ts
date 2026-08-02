import { test, expect, screen, openNote } from './fixtures'

// Feature (2026-08-02): Android routes BT-keyboard characters through Gboard (OS IME),
// so the WebView keydown arrives as keyCode 229 / key='Unidentified' and never reaches
// the keydown kana branch. The editor now also listens on `beforeinput` and feeds its
// `data` into the same jp-ime pipeline. This spec reproduces the Android situation by
// dispatching `beforeinput` events WITHOUT any keydown and asserts romaji still converts
// to kana on the glasses screen.
test('Android beforeinput path: romaji via beforeinput converts to kana on the glasses', async ({ appPage }) => {
  const page = appPage

  const textarea = await openNote(page, 'ime.md')
  await textarea.focus()
  await page.keyboard.press('Control+j') // かなモード ON (keydown 経路のトグルは動く)

  // keydown を伴わない beforeinput を dispatch = Android の keyCode 229 状況を再現。
  for (const ch of ['k', 'y', 'o', 'u']) {
    await page.evaluate(c => {
      const ta = document.querySelector('textarea')!
      ta.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: c, cancelable: true, bubbles: true }))
    }, ch)
  }

  await expect.poll(() => screen(page)).toContain('きょう')
  expect(await textarea.inputValue()).toBe('')
})
