import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalVault, VaultConflictError } from '../src/local-vault'

let vaults: LocalVault[] = []

afterEach(async () => {
  await Promise.all(vaults.map(vault => vault.close()))
  vaults = []
  await deleteDatabase('even-scribe')
})

describe('LocalVault', () => {
  it('creates and reads a note', async () => {
    const vault = createVault()
    const created = await vault.createFile('notes/a.md', 'hello')
    const file = await vault.file('notes/a.md')

    expect(file).toEqual({
      path: 'notes/a.md',
      content: 'hello',
      mtime: created.mtime,
      size: 5,
    })
  })

  it('saveFile updates content and mtime', async () => {
    const vault = createVault()
    const created = await vault.createFile('a.md', 'old')

    const saved = await vault.saveFile('a.md', 'updated', created.mtime)

    expect(saved.mtime).toBeGreaterThan(created.mtime)
    await expect(vault.file('a.md')).resolves.toMatchObject({ content: 'updated', mtime: saved.mtime, size: 7 })
  })

  it('returns recent files by updatedAt descending', async () => {
    const vault = createVault()
    await vault.createFile('old.md', 'old')
    await vault.createFile('new.md', 'new')
    const old = await vault.file('old.md')
    await vault.saveFile('old.md', 'old updated', old.mtime)

    const recent = await vault.recent(10)
    expect(recent.map(entry => entry.path)).toEqual(['old.md', 'new.md'])
  })

  it('synthesizes direct child directories and files for tree listings', async () => {
    const vault = createVault()
    await vault.createFile('root.md', 'root')
    await vault.createFile('notes/a.md', 'a')
    await vault.createFile('notes/deep/b.md', 'b')

    await expect(vault.tree('')).resolves.toMatchObject({
      path: '',
      entries: [
        { name: 'notes', path: 'notes', type: 'dir' },
        { name: 'root.md', path: 'root.md', type: 'file' },
      ],
    })
    await expect(vault.tree('notes')).resolves.toMatchObject({
      path: 'notes',
      entries: [
        { name: 'deep', path: 'notes/deep', type: 'dir' },
        { name: 'a.md', path: 'notes/a.md', type: 'file' },
      ],
    })
  })

  it('creates an empty folder using a hidden placeholder record', async () => {
    const vault = createVault()
    await vault.createFolder('notes/empty')

    await expect(vault.tree('notes')).resolves.toMatchObject({
      path: 'notes',
      entries: [{ name: 'empty', path: 'notes/empty', type: 'dir' }],
    })
    await expect(vault.file('notes/empty/.keep')).resolves.toMatchObject({ content: '' })
  })

  it('renames a file while preserving its content', async () => {
    const vault = createVault()
    await vault.createFile('notes/old.md', 'content')

    await vault.rename('notes/old.md', 'notes/new.md', false)

    await expect(vault.file('notes/old.md')).rejects.toThrow('File not found')
    await expect(vault.file('notes/new.md')).resolves.toMatchObject({ path: 'notes/new.md', content: 'content' })
  })

  it('renames a directory and all records below it', async () => {
    const vault = createVault()
    await vault.createFolder('notes/old')
    await vault.createFile('notes/old/a.md', 'a')
    await vault.createFile('notes/old/deep/b.md', 'b')

    await vault.rename('notes/old', 'notes/new', true)

    await expect(vault.file('notes/old/a.md')).rejects.toThrow('File not found')
    await expect(vault.file('notes/new/a.md')).resolves.toMatchObject({ content: 'a' })
    await expect(vault.file('notes/new/deep/b.md')).resolves.toMatchObject({ content: 'b' })
    await expect(vault.file('notes/new/.keep')).resolves.toMatchObject({ content: '' })
  })

  it('deletes a file, a directory tree, and rejects missing paths', async () => {
    const vault = createVault()
    await vault.createFile('notes/remove.md', 'remove')
    await vault.createFolder('notes/folder')
    await vault.createFile('notes/folder/a.md', 'a')
    await vault.createFile('notes/folder/deep/b.md', 'b')

    await vault.deleteFile('notes/remove.md', false)
    await expect(vault.file('notes/remove.md')).rejects.toThrow('File not found')

    await vault.deleteFile('notes/folder', true)
    await expect(vault.file('notes/folder/a.md')).rejects.toThrow('File not found')
    await expect(vault.file('notes/folder/deep/b.md')).rejects.toThrow('File not found')

    await expect(vault.deleteFile('notes/missing.md', false)).rejects.toThrow('File not found')
    await expect(vault.deleteFile('notes/missing', true)).rejects.toThrow('Path not found')
  })

  it('rejects folder creation and renames that would collide with existing paths', async () => {
    const vault = createVault()
    await vault.createFile('notes/existing.md', 'existing')
    await vault.createFolder('notes/folder')

    await expect(vault.createFolder('notes/folder')).rejects.toThrow('Path already exists')
    await expect(vault.rename('notes/existing.md', 'notes/folder', false)).rejects.toThrow('Path already exists')
    await expect(vault.rename('notes/folder', 'notes/existing.md', true)).rejects.toThrow('Path already exists')
  })

  it('throws VaultConflictError on stale baseMtime', async () => {
    const vault = createVault()
    const created = await vault.createFile('a.md', 'old')

    await vault.saveFile('a.md', 'new', created.mtime)

    await expect(vault.saveFile('a.md', 'stale', created.mtime)).rejects.toBeInstanceOf(VaultConflictError)
  })
})

function createVault(): LocalVault {
  const vault = new LocalVault()
  vaults.push(vault)
  return vault
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'))
    request.onblocked = () => resolve()
  })
}
