import { test, expect, screen, openNote } from './fixtures'

// Feature (S-09, 2026-08-03): every kanji-conversion candidate lookup records its
// network latency (reading / ms / ok) so the local-fallback threshold (S-08) can be
// chosen from real data. The log lives on window.__imeTimingLog (persisted to
// localStorage) and is dumpable via window.__dumpImeTiming(). Here we drive a real
// conversion through the app and assert an entry was recorded.
test('conversion lookups are timed and recorded on window.__imeTimingLog', async ({ appPage }) => {
  const page = appPage

  const textarea = await openNote(page, 'ime.md')
  await textarea.focus()
  await page.keyboard.press('Control+j') // かなモード ON
  await page.keyboard.type('kyou')
  await expect.poll(() => screen(page)).toContain('きょう') // ひらがな合成まで
  await page.keyboard.press('Space') // 変換 = 候補取得(ネットワーク lookup)が走る

  // lookup が走ると計測が 1 件以上記録される(デバウンス分 poll で待つ)。
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __imeTimingLog?: unknown[] }).__imeTimingLog?.length ?? 0))
    .toBeGreaterThan(0)

  const log = await page.evaluate(() => (window as unknown as { __imeTimingLog?: Array<{ reading: string; ms: number; ok: boolean }> }).__imeTimingLog ?? [])
  expect(log.length).toBeGreaterThan(0)
  const hit = log.find(e => e.reading.includes('きょう'))
  expect(hit, 'a timing entry for the きょう reading').toBeTruthy()
  expect(hit!.ok).toBe(true)
  expect(hit!.ms).toBeGreaterThanOrEqual(0)

  // ダンプが summary + entries を返す
  const dump = await page.evaluate(() => (window as unknown as { __dumpImeTiming?: () => string }).__dumpImeTiming?.() ?? '')
  expect(dump).toContain('summary')
  expect(dump).toContain('きょう')
})
