import { test as base, expect, type Locator, type Page } from '@playwright/test'

// Even Scribe stores notes locally in IndexedDB (DB "even-scribe", store "notes",
// keyPath "path"). IndexedDB works natively in headless Chromium, so we seed it
// directly rather than mocking storage. IME candidate lookup (Google inputtools)
// is the one network call, mocked deterministically below.

export interface SeedNote {
  path: string
  content: string
}

const LONG_NOTE_LINES = Array.from({ length: 20 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`)

export const SEED: SeedNote[] = [
  { path: 'ime.md', content: '' },
  { path: 'longnote.md', content: LONG_NOTE_LINES.join('\n') },
]

async function seedVault(page: Page, notes: SeedNote[]): Promise<void> {
  await page.evaluate(async seed => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('even-scribe', 1)
      // The store is created by the app on first load; if this runs first, create it.
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('notes')) {
          const store = db.createObjectStore('notes', { keyPath: 'path' })
          store.createIndex('updatedAt', 'updatedAt')
        }
      }
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('notes', 'readwrite')
        const store = tx.objectStore('notes')
        let t = 2000
        for (const note of seed) {
          const name = note.path.split('/').pop() ?? note.path
          store.put({
            path: note.path,
            name,
            content: note.content,
            updatedAt: ++t,
            size: new TextEncoder().encode(note.content).byteLength,
          })
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, notes)
}

type Fixtures = {
  appPage: Page
}

export const test = base.extend<Fixtures>({
  appPage: async ({ page }, use) => {
    // Deterministic IME candidate lookup: きょう -> 今日 / 京 (any other reading
    // just echoes, which is enough for these scenarios).
    await page.route('**/inputtools.google.com/**', route => {
      const text = new URL(route.request().url()).searchParams.get('text') ?? ''
      const candidates = text.includes('きょう') ? ['今日', '京'] : [text]
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(['SUCCESS', [[text, candidates, [], {}]]]),
      })
    })

    // First load creates the IndexedDB store; then seed and reload so RECENT shows
    // the seeded notes.
    await page.goto('/')
    await expect(page.locator('#screen')).toBeVisible({ timeout: 10_000 })
    await seedVault(page, SEED)
    await page.reload()
    await expect(page.locator('#screen')).toContainText('longnote', { timeout: 10_000 })
    await page.waitForTimeout(700) // let the 500ms startup input-lock elapse

    await use(page)
  },
})

/** The current glasses screen text. In EDIT mode `#screen` is replaced by the
 * editor, so fall back to the last text pushed to the glasses (mock bridge). */
export async function screen(page: Page): Promise<string> {
  const mirror = page.locator('#screen')
  if ((await mirror.count()) > 0) return (await mirror.textContent()) ?? ''
  return (await page.evaluate(() => window.__lastGlassesText ?? '')) ?? ''
}

/** Push a glasses ring/touch scroll gesture through the real SDK event path. */
export async function ringScroll(page: Page, direction: 'up' | 'down'): Promise<void> {
  await page.evaluate(dir => {
    // OsEventTypeList: SCROLL_TOP_EVENT = 1, SCROLL_BOTTOM_EVENT = 2
    window.__emitEvenHubEvent?.({ sysEvent: { eventType: dir === 'up' ? 1 : 2 } })
  }, direction)
}

/**
 * From the RECENT list, move the selection down onto the named note and open it
 * into EDIT. Returns the editor textarea locator. Use this instead of hand-rolling
 * ArrowDown counts in every spec.
 */
export async function openNote(page: Page, name: string): Promise<Locator> {
  for (let i = 0; i < 15 && !(await screen(page)).includes(`> ${name}`); i++) {
    await page.keyboard.press('ArrowDown')
  }
  expect(await screen(page), `note "${name}" not found in RECENT`).toContain(`> ${name}`)
  await page.keyboard.press('Enter')
  const textarea = page.locator('textarea')
  await expect(textarea).toBeVisible()
  return textarea
}

/** Toggle the kana IME on/off (Ctrl+Space), from a focused editor. */
export async function imeToggle(page: Page): Promise<void> {
  await page.keyboard.press('Control+Space')
}

export { expect }
