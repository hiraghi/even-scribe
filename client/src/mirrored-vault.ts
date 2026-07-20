import type { FileResult, FileWriteResult, TreeResult, VaultEntry, VaultStorage } from '@eveng2/g2-core'
import { VaultConflictError } from './local-vault'

/**
 * Combines the native KV vault and IndexedDB vault. IndexedDB is authoritative
 * for mutations and conflicts; native writes are attempted for hardware
 * persistence without allowing a bridge failure to discard a local change.
 */
export class MirroredVault implements VaultStorage {
  constructor(
    private readonly local: VaultStorage,
    private readonly native: VaultStorage,
  ) {}

  async recent(limit: number): Promise<VaultEntry[]> {
    const [local, native] = await Promise.all([this.entries(() => this.local.recent(Number.MAX_SAFE_INTEGER), 'local recent'), this.entries(() => this.native.recent(Number.MAX_SAFE_INTEGER), 'native recent')])
    return mergeEntries(local, native).sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path)).slice(0, limit)
  }

  async tree(path: string): Promise<TreeResult> {
    const [local, native] = await Promise.all([this.treeResult(() => this.local.tree(path), 'local tree'), this.treeResult(() => this.native.tree(path), 'native tree')])
    const resultPath = local?.path ?? native?.path ?? path
    return { path: resultPath, entries: mergeEntries(local?.entries ?? [], native?.entries ?? []).sort(compareTreeEntries) }
  }

  async file(path: string): Promise<FileResult> {
    const [local, native] = await Promise.all([this.fileResult(() => this.local.file(path)), this.fileResult(() => this.native.file(path))])
    if (local && native) return local.mtime >= native.mtime ? local : native
    if (local) return local
    if (native) return native
    throw new Error(`File not found: ${path}`)
  }

  async saveFile(path: string, content: string, baseMtime?: number): Promise<FileWriteResult> {
    const visible = await this.file(path)
    if (baseMtime !== undefined && visible.mtime !== baseMtime) throw new VaultConflictError()
    const localExisting = await this.localFile(path)
    const localResult = localExisting
      ? await this.local.saveFile(path, content, localExisting.mtime)
      : await this.local.createFile(path, content)
    await this.bestEffort(() => this.writeNativeFile(path, content), `Native vault save failed: ${path}`)
    return this.currentWriteResult(path, localResult)
  }

  async createFile(path: string, content: string): Promise<FileWriteResult> {
    const result = await this.local.createFile(path, content)
    await this.bestEffort(async () => {
      await this.native.createFile(path, content)
    }, `Native vault create failed: ${path}`)
    return this.currentWriteResult(path, result)
  }

  async createFolder(path: string): Promise<void> {
    await this.local.createFolder(path)
    await this.bestEffort(() => this.native.createFolder(path), `Native vault folder creation failed: ${path}`)
  }

  async rename(oldPath: string, newPath: string, isDir: boolean): Promise<void> {
    await this.local.rename(oldPath, newPath, isDir)
    await this.bestEffort(() => this.native.rename(oldPath, newPath, isDir), `Native vault rename failed: ${oldPath}`)
  }

  async deleteFile(path: string, isDir: boolean): Promise<void> {
    await this.local.deleteFile(path, isDir)
    await this.bestEffort(() => this.native.deleteFile(path, isDir), `Native vault delete failed: ${path}`)
  }

  private async writeNativeFile(path: string, content: string): Promise<void> {
    const existing = await this.nativeFile(path)
    if (existing) {
      await this.native.saveFile(path, content)
      return
    }
    await this.native.createFile(path, content)
  }

  private async currentWriteResult(path: string, localResult: FileWriteResult): Promise<FileWriteResult> {
    const current = await this.file(path)
    return { path: current.path, mtime: current.mtime, size: current.size ?? localResult.size }
  }

  private async localFile(path: string): Promise<FileResult | null> {
    return this.fileResult(() => this.local.file(path))
  }

  private async nativeFile(path: string): Promise<FileResult | null> {
    return this.fileResult(() => this.native.file(path))
  }

  private async entries(read: () => Promise<VaultEntry[]>, label: string): Promise<VaultEntry[]> {
    try {
      return await read()
    } catch (error) {
      console.warn(`${label} read failed`, error)
      return []
    }
  }

  private async treeResult(read: () => Promise<TreeResult>, label: string): Promise<TreeResult | null> {
    try {
      return await read()
    } catch (error) {
      console.warn(`${label} read failed`, error)
      return null
    }
  }

  private async fileResult(read: () => Promise<FileResult>): Promise<FileResult | null> {
    try {
      return await read()
    } catch {
      return null
    }
  }

  private async bestEffort(write: () => Promise<void>, message: string): Promise<void> {
    try {
      await write()
    } catch (error) {
      console.warn(message, error)
    }
  }
}

function mergeEntries(local: VaultEntry[], native: VaultEntry[]): VaultEntry[] {
  const entries = new Map<string, VaultEntry>()
  for (const entry of [...local, ...native]) {
    const existing = entries.get(entry.path)
    if (!existing || entry.mtime > existing.mtime) entries.set(entry.path, entry)
  }
  return [...entries.values()]
}

function compareTreeEntries(a: VaultEntry, b: VaultEntry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
}
