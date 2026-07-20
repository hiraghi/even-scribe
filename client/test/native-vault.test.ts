import { describe, expect, it } from 'vitest'
import type { KeyValueStorage } from '@eveng2/g2-core'
import { NativeVault } from '../src/native-vault'

class MemoryKeyValueStorage implements KeyValueStorage {
  readonly values = new Map<string, string>()

  async get(key: string): Promise<string> {
    return this.values.get(key) ?? ''
  }

  async set(key: string, value: string): Promise<boolean> {
    this.values.set(key, value)
    return true
  }
}

describe('NativeVault', () => {
  it('persists files through the native key/value index across vault instances', async () => {
    const storage = new MemoryKeyValueStorage()
    const first = new NativeVault(storage)
    await first.createFile('notes/hello.md', 'hello')
    const saved = await first.saveFile('notes/hello.md', 'updated')

    const reloaded = new NativeVault(storage)
    expect(await reloaded.recent(10)).toMatchObject([{ path: 'notes/hello.md', mtime: saved.mtime }])
    expect(await reloaded.file('notes/hello.md')).toMatchObject({ content: 'updated', mtime: saved.mtime })
    expect(await reloaded.tree('')).toMatchObject({ entries: [{ path: 'notes', type: 'dir' }] })
  })

  it('splits large unicode content into native KV chunks without data loss', async () => {
    const storage = new MemoryKeyValueStorage()
    const vault = new NativeVault(storage)
    const content = 'あ'.repeat(20_000)
    await vault.createFile('large.md', content)

    expect(await vault.file('large.md')).toMatchObject({ content })
    expect([...storage.values.keys()].filter(key => key.startsWith('even-scribe.vault.note.large.md_'))).toHaveLength(2)
  })
})
