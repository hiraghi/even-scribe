import type { FileResult, FileWriteResult, KeyValueStorage, TreeResult, VaultEntry, VaultStorage } from '@eveng2/g2-core'
import { VaultConflictError } from './local-vault'

const INDEX_KEY = 'even-scribe.vault.index'
const NOTE_KEY_PREFIX = 'even-scribe.vault.note.'
const CHUNK_SIZE = 50 * 1024
const FOLDER_PLACEHOLDER = '.keep'
let lastTimestamp = 0

interface StoredNote {
  path: string
  name: string
  content: string
  updatedAt: number
  size: number
}

interface StoredNoteMetadata {
  path: string
  name: string
  updatedAt: number
  size: number
  chunks: number
}

/** A VaultStorage backed by Even Hub's native, restart-persistent KV store. */
export class NativeVault implements VaultStorage {
  constructor(private readonly storage: KeyValueStorage) {}

  async recent(limit: number): Promise<VaultEntry[]> {
    const records = await this.records()
    return records
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(recordToEntry)
  }

  async tree(path = ''): Promise<TreeResult> {
    const normalized = normalizeDir(path)
    const records = await this.records()
    const dirs = new Map<string, VaultEntry>()
    const files: VaultEntry[] = []
    const prefix = normalized ? `${normalized}/` : ''

    for (const record of records) {
      if (!record.path.startsWith(prefix)) continue
      const rest = record.path.slice(prefix.length)
      if (!rest || rest.startsWith('/')) continue
      const slash = rest.indexOf('/')
      if (slash === -1) {
        files.push(recordToEntry(record))
        continue
      }
      const name = rest.slice(0, slash)
      const dirPath = prefix + name
      const previous = dirs.get(dirPath)
      dirs.set(dirPath, { name, path: dirPath, type: 'dir', mtime: Math.max(previous?.mtime ?? 0, record.updatedAt), size: 0 })
    }

    return {
      path: normalized,
      entries: [...dirs.values(), ...files].sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name))),
    }
  }

  async file(path: string): Promise<FileResult> {
    const normalized = normalizePath(path)
    const record = await this.readRecord(normalized)
    if (!record) throw new Error(`File not found: ${normalized}`)
    return { path: record.path, content: record.content, mtime: record.updatedAt, size: record.size }
  }

  async saveFile(path: string, content: string, baseMtime?: number): Promise<FileWriteResult> {
    const normalized = normalizePath(path)
    const existing = await this.readRecord(normalized)
    if (!existing) throw new Error(`File not found: ${normalized}`)
    if (baseMtime !== undefined && existing.updatedAt !== baseMtime) throw new VaultConflictError()
    const record = createRecord(normalized, content, existing.updatedAt)
    await this.writeRecord(record)
    return recordToWriteResult(record)
  }

  async createFile(path: string, content: string): Promise<FileWriteResult> {
    const normalized = normalizePath(path)
    const paths = await this.paths()
    if (paths.includes(normalized)) throw new Error(`Path already exists: ${normalized}`)
    const record = createRecord(normalized, content)
    await this.writeRecord(record)
    await this.writePaths([...paths, normalized])
    return recordToWriteResult(record)
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizePath(path)
    const paths = await this.paths()
    if (paths.some(item => item === normalized || item.startsWith(`${normalized}/`))) throw new Error(`Path already exists: ${normalized}`)
    const placeholderPath = `${normalized}/${FOLDER_PLACEHOLDER}`
    await this.writeRecord(createRecord(placeholderPath, ''))
    await this.writePaths([...paths, placeholderPath])
  }

  async rename(oldPath: string, newPath: string, isDir: boolean): Promise<void> {
    const oldNormalized = normalizePath(oldPath)
    const newNormalized = normalizePath(newPath)
    if (oldNormalized === newNormalized) throw new Error(`Path already exists: ${newNormalized}`)
    if (isDir && newNormalized.startsWith(`${oldNormalized}/`)) throw new Error('Cannot rename a folder into itself')

    const records = await this.records()
    const source = isDir ? records.filter(record => record.path.startsWith(`${oldNormalized}/`)) : records.filter(record => record.path === oldNormalized)
    if (source.length === 0) throw new Error(`Path not found: ${oldNormalized}`)
    const sourcePaths = new Set(source.map(record => record.path))
    const destinationPaths = source.map(record => (isDir ? `${newNormalized}/${record.path.slice(oldNormalized.length + 1)}` : newNormalized))
    const occupied = records.some(record => !sourcePaths.has(record.path) && (record.path === newNormalized || record.path.startsWith(`${newNormalized}/`)))
    if (occupied || new Set(destinationPaths).size !== destinationPaths.length) throw new Error(`Path already exists: ${newNormalized}`)

    for (let index = 0; index < source.length; index += 1) {
      await this.writeRecord(createRecord(destinationPaths[index], source[index].content, source[index].updatedAt))
    }
    await this.writePaths(records.filter(record => !sourcePaths.has(record.path)).map(record => record.path).concat(destinationPaths))
  }

  async deleteFile(path: string, isDir: boolean): Promise<void> {
    const normalized = normalizePath(path)
    const records = await this.records()
    const targets = isDir ? records.filter(record => record.path === normalized || record.path.startsWith(`${normalized}/`)) : records.filter(record => record.path === normalized)
    if (targets.length === 0) throw new Error(`Path not found: ${normalized}`)
    const deleted = new Set(targets.map(record => record.path))
    await this.writePaths(records.filter(record => !deleted.has(record.path)).map(record => record.path))
  }

  private async paths(): Promise<string[]> {
    const raw = await this.storage.get(INDEX_KEY)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed) || !parsed.every(path => typeof path === 'string')) throw new Error('invalid vault index')
      return [...new Set(parsed)]
    } catch {
      throw new Error('Native vault index is corrupted')
    }
  }

  private async writePaths(paths: string[]): Promise<void> {
    await this.write(INDEX_KEY, JSON.stringify(paths))
  }

  private async records(): Promise<StoredNote[]> {
    const paths = await this.paths()
    const records = await Promise.all(paths.map(path => this.readRecord(path)))
    return records.filter((record): record is StoredNote => record !== null)
  }

  private async readRecord(path: string): Promise<StoredNote | null> {
    const metadataRaw = await this.storage.get(noteKey(path))
    if (!metadataRaw) return null
    let metadata: StoredNoteMetadata
    try {
      const parsed: unknown = JSON.parse(metadataRaw)
      if (!isMetadata(parsed)) throw new Error('invalid note metadata')
      metadata = parsed
    } catch {
      throw new Error(`Native vault note is corrupted: ${path}`)
    }
    const chunks = await Promise.all(Array.from({ length: metadata.chunks }, (_, index) => this.storage.get(`${noteKey(path)}_${index}`)))
    if (metadata.size > 0 && chunks.some(chunk => chunk === '')) throw new Error(`Native vault note is incomplete: ${path}`)
    return { path: metadata.path, name: metadata.name, content: chunks.join(''), updatedAt: metadata.updatedAt, size: metadata.size }
  }

  private async writeRecord(record: StoredNote): Promise<void> {
    const chunks = splitContent(record.content)
    for (let index = 0; index < chunks.length; index += 1) await this.write(`${noteKey(record.path)}_${index}`, chunks[index])
    await this.write(noteKey(record.path), JSON.stringify({ path: record.path, name: record.name, updatedAt: record.updatedAt, size: record.size, chunks: chunks.length }))
  }

  private async write(key: string, value: string): Promise<void> {
    if (!(await this.storage.set(key, value))) throw new Error(`Native storage write failed: ${key}`)
  }
}

function splitContent(content: string): string[] {
  if (content === '') return ['']
  const encoder = new TextEncoder()
  const chunks: string[] = []
  let chunk = ''
  let bytes = 0
  for (const character of content) {
    const characterBytes = encoder.encode(character).byteLength
    if (chunk && bytes + characterBytes > CHUNK_SIZE) {
      chunks.push(chunk)
      chunk = ''
      bytes = 0
    }
    chunk += character
    bytes += characterBytes
  }
  chunks.push(chunk)
  return chunks
}

function isMetadata(value: unknown): value is StoredNoteMetadata {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StoredNoteMetadata>
  const chunks = item.chunks
  return typeof item.path === 'string' && typeof item.name === 'string' && typeof item.updatedAt === 'number' && typeof item.size === 'number' && typeof chunks === 'number' && Number.isInteger(chunks) && chunks > 0
}

function noteKey(path: string): string {
  return `${NOTE_KEY_PREFIX}${encodeURIComponent(path)}`
}

function createRecord(path: string, content: string, previousUpdatedAt = 0): StoredNote {
  const updatedAt = nextTimestamp(previousUpdatedAt)
  return { path, name: fileName(path), content, updatedAt, size: new TextEncoder().encode(content).byteLength }
}

function nextTimestamp(previousUpdatedAt: number): number {
  lastTimestamp = Math.max(Date.now(), previousUpdatedAt + 1, lastTimestamp + 1)
  return lastTimestamp
}

function recordToEntry(record: StoredNote): VaultEntry {
  return { name: record.name, path: record.path, type: 'file', mtime: record.updatedAt, size: record.size }
}

function recordToWriteResult(record: StoredNote): FileWriteResult {
  return { path: record.path, mtime: record.updatedAt, size: record.size }
}

function normalizePath(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
  if (!normalized) throw new Error('Path is required')
  return normalized
}

function normalizeDir(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

function fileName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}
