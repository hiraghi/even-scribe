import { test, expect, screen, openNote } from './fixtures'

async function storedContent(page: Parameters<typeof screen>[0], path: string): Promise<string | undefined> {
  return page.evaluate(async notePath => {
    return await new Promise<string | undefined>((resolve, reject) => {
      const request = indexedDB.open('even-scribe', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('notes', 'readonly')
        const get = transaction.objectStore('notes').get(notePath)
        get.onerror = () => reject(get.error)
        get.onsuccess = () => {
          db.close()
          resolve((get.result as { content?: string } | undefined)?.content)
        }
      }
    })
  }, path)
}

test('touching a shell list item opens the matching file', async ({ appPage }) => {
  const page = appPage
  await expect(page.locator('#screen')).toContainText('longnote')

  await page.locator('#file-list button[data-path="longnote.md"]').click()
  await expect(page.locator('textarea')).toBeVisible()
  await expect.poll(() => screen(page)).toContain('longnote.md')
})

test('a glasses single click saves an edit', async ({ appPage }) => {
  const page = appPage
  const textarea = await openNote(page, 'ime.md')
  await textarea.fill('saved by click')

  await page.evaluate(() => window.__emitEvenHubEvent?.({ sysEvent: { eventType: 0 } }))
  await expect.poll(() => storedContent(page, 'ime.md')).toBe('saved by click')

  await page.reload()
  await expect(page.locator('#screen')).toContainText('ime')
  await page.locator('#file-list button[data-path="ime.md"]').click()
  await expect(page.locator('textarea')).toHaveValue('saved by click')
})

test('the browser IndexedDB fallback keeps saved notes after reload', async ({ appPage }) => {
  const page = appPage
  const textarea = await openNote(page, 'ime.md')
  await textarea.fill('survives reload')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => storedContent(page, 'ime.md')).toBe('survives reload')

  await page.reload()
  await expect(page.locator('#screen')).toContainText('ime')
  await page.locator('#file-list button[data-path="ime.md"]').click()
  await expect(page.locator('textarea')).toHaveValue('survives reload')
})
