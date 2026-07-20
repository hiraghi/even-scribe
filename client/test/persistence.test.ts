import { describe, expect, it } from 'vitest'
import type { KeyValueStorage } from '@eveng2/g2-core'
import { MirroredPersistence } from '../src/persistence'

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>()
  failWrites = false

  async get(key: string): Promise<string> {
    return this.values.get(key) ?? ''
  }

  async set(key: string, value: string): Promise<boolean> {
    if (this.failWrites) return false
    this.values.set(key, value)
    return true
  }
}

describe('MirroredPersistence', () => {
  it('prefers a native value and falls back to browser storage when native KV is empty', async () => {
    const native = new MemoryStorage()
    const browser = new MemoryStorage()
    browser.values.set('draft', 'browser draft')
    const persistence = new MirroredPersistence(native, browser)

    await expect(persistence.get('draft')).resolves.toBe('browser draft')
    native.values.set('draft', 'native draft')
    await expect(persistence.get('draft')).resolves.toBe('native draft')
  })

  it('writes to both stores and succeeds when exactly one backend persists', async () => {
    const native = new MemoryStorage()
    const browser = new MemoryStorage()
    const persistence = new MirroredPersistence(native, browser)

    await expect(persistence.set('settings', 'value')).resolves.toBe(true)
    expect(native.values.get('settings')).toBe('value')
    expect(browser.values.get('settings')).toBe('value')

    native.failWrites = true
    await expect(persistence.set('settings', 'browser only')).resolves.toBe(true)
    expect(browser.values.get('settings')).toBe('browser only')
  })
})
