import { test, expect } from '@playwright/test'
import { openNote, screen } from './fixtures'

// Bundled-note seeding runs on real boot. These specs use a RAW page (not the shared
// appPage fixture, which suppresses seeding by pre-setting the seed-version marker),
// so production seeding actually runs against the real app.

const MANUAL = '使い方'
const CHANGELOG = 'CHANGELOG'
const SEED_VERSION_KEY = 'even-scribe.seeded-version'

test('first launch seeds the 使い方 and CHANGELOG notes into RECENT', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#screen')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(700) // let the 500ms startup input-lock elapse

  const recent = await screen(page)
  expect(recent).toContain(MANUAL)
  expect(recent).toContain(CHANGELOG)

  const manual = await openNote(page, MANUAL)
  await expect(manual).toHaveValue(/Even Scribe の使い方/)
  await expect(manual).toHaveValue(/困ったとき/)
})

test('re-seeds the bundled notes on version change but keeps user notes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#screen')).toBeVisible({ timeout: 10_000 })

  // Simulate a stale install: the manual note was edited, the user made their own
  // note, and the stored seed version is older than the current app version.
  await page.evaluate(async key => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('even-scribe', 1)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('notes', 'readwrite')
        const store = tx.objectStore('notes')
        const enc = new TextEncoder()
        const put = (path: string, content: string, updatedAt: number) =>
          store.put({ path, name: path, content, updatedAt, size: enc.encode(content).byteLength })
        put('使い方.md', 'USER EDIT SENTINEL', 9_000_000)
        put('keep-me.md', 'mine', 9_000_001)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
    localStorage.setItem(key, '0.0.1')
  }, SEED_VERSION_KEY)

  await page.reload()
  await expect(page.locator('#screen')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(700)

  const recent = await screen(page)
  expect(recent).toContain('keep-me') // the user's own note is preserved
  expect(recent).toContain(MANUAL)

  // The manual note is overwritten back to the bundled content (sentinel gone).
  const manual = await openNote(page, MANUAL)
  await expect(manual).toHaveValue(/Even Scribe の使い方/)
  await expect(manual).not.toHaveValue(/USER EDIT SENTINEL/)
})
