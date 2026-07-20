import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { KeyValueStorage } from '@eveng2/g2-core'
import { LocalVault } from '../src/local-vault'
import { MirroredVault } from '../src/mirrored-vault'
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

let local: LocalVault | null = null

afterEach(async () => {
  await local?.close()
  local = null
  await deleteDatabase('even-scribe')
})

describe('MirroredVault', () => {
  it('unions native and IndexedDB notes and keeps the newest duplicate', async () => {
    const { mirror, native } = createVault()
    await mirror.createFile('local.md', 'local')
    await native.createFile('native.md', 'native')
    await native.createFile('shared.md', 'native old')
    await new Promise(resolve => setTimeout(resolve, 2))
    await local!.createFile('shared.md', 'local new')

    expect((await mirror.recent(10)).map(entry => entry.path)).toEqual(expect.arrayContaining(['local.md', 'native.md', 'shared.md']))
    await expect(mirror.file('shared.md')).resolves.toMatchObject({ content: 'local new' })
    expect((await mirror.tree('')).entries.map(entry => entry.path)).toEqual(expect.arrayContaining(['local.md', 'native.md', 'shared.md']))
  })

  it('writes to both vaults and still reads the IndexedDB copy after native KV is lost', async () => {
    const { mirror, nativeStorage } = createVault()
    await mirror.createFolder('notes')
    await mirror.createFile('notes/survives.md', 'saved')
    const created = await mirror.file('notes/survives.md')
    await mirror.saveFile('notes/survives.md', 'updated', created.mtime)

    await expect(local!.file('notes/survives.md')).resolves.toMatchObject({ content: 'updated' })
    expect(nativeStorage.values.get('even-scribe.vault.index')).toContain('notes/survives.md')
    nativeStorage.values.clear()

    await expect(mirror.file('notes/survives.md')).resolves.toMatchObject({ content: 'updated' })
    expect((await mirror.tree('notes')).entries.map(entry => entry.path)).toContain('notes/survives.md')
  })
})

function createVault(): { mirror: MirroredVault; native: NativeVault; nativeStorage: MemoryKeyValueStorage } {
  local = new LocalVault()
  const nativeStorage = new MemoryKeyValueStorage()
  const native = new NativeVault(nativeStorage)
  return { mirror: new MirroredVault(local, native), native, nativeStorage }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'))
    request.onblocked = () => resolve()
  })
}
