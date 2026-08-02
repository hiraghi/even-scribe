import { test, expect, screen, openNote } from './fixtures'

// Feature (S-07, 2026-08-03): while a conversion candidate lookup is in flight
// (slow / unstable network), the glasses show a "変換中…" indicator so the user
// knows candidates are being fetched. We override the fixture's instant IME mock
// with a delayed one so the pending window is observable, then assert the marker
// appears during the wait and disappears once candidates arrive.
test('shows 変換中… on the glasses while conversion candidates are being fetched', async ({ appPage }) => {
  const page = appPage

  // Delay the candidate response so the loading window is observable.
  await page.route('**/inputtools.google.com/**', async route => {
    const text = new URL(route.request().url()).searchParams.get('text') ?? ''
    const candidates = text.includes('きょう') ? ['今日', '京'] : [text]
    await new Promise(resolve => setTimeout(resolve, 800))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(['SUCCESS', [[text, candidates, [], {}]]]),
    })
  })

  const textarea = await openNote(page, 'ime.md')
  await textarea.focus()
  await page.keyboard.press('Control+j') // かなモード ON
  await page.keyboard.type('kyou')
  await expect.poll(() => screen(page)).toContain('きょう')
  await page.keyboard.press('Space') // 変換 = lookup 開始(800ms 遅延)

  // 取得中インジケータが出る
  await expect.poll(() => screen(page)).toContain('変換中…')
  // 候補が返ると消えて候補が出る
  await expect.poll(() => screen(page)).toContain('今日')
  expect(await screen(page)).not.toContain('変換中…')
})
