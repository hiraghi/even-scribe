import { expect, test } from './fixtures'

test('key debug logger is hidden by default and follows the persisted settings toggle', async ({ page }) => {
  await page.goto('/')

  const panel = page.locator('#key-debug')
  await expect(panel).toBeHidden()

  await page.locator('#key-debug-log').check()
  await expect(panel).toBeVisible()
})

test('key debug logger captures keydown events before application handlers', async ({ page }) => {
  await page.goto('/?keydebug=1')

  const panel = page.locator('#key-debug')
  await expect(panel).toBeVisible()

  const before = await page.evaluate(() => (window as typeof window & { __keyLog: unknown[] }).__keyLog.length)

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, bubbles: true }))
  })
  await expect(panel).toContainText('key=ArrowUp')
  await expect(panel).toContainText('keyCode=38')

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true, bubbles: true }))
  })
  await expect(panel).toContainText('ctrl=true')

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', code: 'Unidentified', keyCode: 229, which: 229, bubbles: true }))
  })
  await expect(panel).toContainText('keyCode=229')

  const after = await page.evaluate(() => (window as typeof window & { __keyLog: unknown[] }).__keyLog.length)
  expect(after).toBeGreaterThanOrEqual(before + 3)
})
