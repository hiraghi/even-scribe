import { test, expect, screen, openNote } from './fixtures'

// Feature (S-15, 2026-08-03): typing a reading, pressing Space, then Enter *before*
// the conversion candidates arrive must NOT commit the raw kana. Instead the word is
// parked in the draft as a `[*reading]` marker so the user can keep typing, and each
// marker is replaced by the top candidate once its own lookup returns. Multiple words
// can be pending at once (unstable network). We delay the IME mock so the pending
// window is observable through the real app (glasses `#screen` renders the draft).

test('Space→Enter before candidates arrive defers to a bracket marker, then resolves to the top candidate', async ({ appPage }) => {
  const page = appPage

  await page.route('**/inputtools.google.com/**', async route => {
    const text = new URL(route.request().url()).searchParams.get('text') ?? ''
    const candidates = text.includes('きょう') ? ['今日', '京'] : [text]
    await new Promise(r => setTimeout(r, 800))
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
  await page.keyboard.press('Enter') // 候補到着前に確定 → 保留マーカーへ

  // 生かな単体確定ではなく、[*きょう] の保留マーカーになっている
  await expect.poll(() => screen(page)).toContain('[*きょう]')
  // 候補到着で先頭候補に置換され、マーカーは消える
  await expect.poll(() => screen(page), { timeout: 5000 }).toContain('今日')
  expect(await screen(page)).not.toContain('[*きょう]')
})

test('multiple words can be pending at once and all resolve to the top candidate', async ({ appPage }) => {
  const page = appPage

  await page.route('**/inputtools.google.com/**', async route => {
    const text = new URL(route.request().url()).searchParams.get('text') ?? ''
    const candidates = text.includes('きょう') ? ['今日', '京'] : [text]
    await new Promise(r => setTimeout(r, 600))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(['SUCCESS', [[text, candidates, [], {}]]]),
    })
  })

  const textarea = await openNote(page, 'ime.md')
  await textarea.focus()
  await page.keyboard.press('Control+j')
  for (let i = 0; i < 2; i++) {
    await page.keyboard.type('kyou')
    await expect.poll(() => screen(page)).toContain('きょう')
    await page.keyboard.press('Space')
    await page.keyboard.press('Enter')
  }

  // 2 語とも保留され、遅延経過後にどちらも今日へ解決する
  await expect.poll(() => screen(page), { timeout: 6000 }).toContain('今日今日')
  expect(await screen(page)).not.toContain('[*')
})
