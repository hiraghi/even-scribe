import type { FileResult, FileWriteResult, TreeResult, VaultEntry, VaultStorage } from '@eveng2/g2-core'

const DB_NAME = 'even-scribe'
const DB_VERSION = 1
const STORE_NAME = 'notes'
const FOLDER_PLACEHOLDER = '.keep'
let lastTimestamp = 0

interface NoteRecord {
  path: string
  name: string
  content: string
  updatedAt: number
  size: number
}

export class VaultConflictError extends Error {
  constructor(message = 'Local copy changed. Reload before retry.') {
    super(message)
    this.name = 'VaultConflictError'
  }
}

export class LocalVault implements VaultStorage {
  private dbPromise: Promise<IDBDatabase> | null = null

  async close(): Promise<void> {
    const db = await this.dbPromise
    db?.close()
    this.dbPromise = null
  }

  recent(limit: number): Promise<VaultEntry[]> {
    return this.withStore('readonly', store =>
      requestToPromise(store.index('updatedAt').getAll()).then(records =>
        records
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit)
          .map(recordToEntry),
      ),
    )
  }

  async tree(path = ''): Promise<TreeResult> {
    const normalized = normalizeDir(path)
    const records = await this.withStore('readonly', store => requestToPromise(store.getAll()))
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
      dirs.set(dirPath, {
        name,
        path: dirPath,
        type: 'dir',
        mtime: Math.max(previous?.mtime ?? 0, record.updatedAt),
        size: 0,
      })
    }

    return {
      path: normalized,
      entries: [...dirs.values(), ...files].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    }
  }

  async file(path: string): Promise<FileResult> {
    const normalized = normalizePath(path)
    const record = await this.withStore('readonly', store => requestToPromise(store.get(normalized)))
    if (!record) throw new Error(`File not found: ${normalized}`)
    return {
      path: record.path,
      content: record.content,
      mtime: record.updatedAt,
      size: record.size,
    }
  }

  async saveFile(path: string, content: string, baseMtime?: number): Promise<FileWriteResult> {
    const normalized = normalizePath(path)
    return this.withStore('readwrite', async store => {
      const existing = await requestToPromise(store.get(normalized))
      if (!existing) throw new Error(`File not found: ${normalized}`)
      if (baseMtime !== undefined && existing.updatedAt !== baseMtime) throw new VaultConflictError()
      const record = createRecord(normalized, content, existing.updatedAt)
      await requestToPromise(store.put(record))
      return recordToWriteResult(record)
    })
  }

  async createFile(path: string, content: string): Promise<FileWriteResult> {
    const normalized = normalizePath(path)
    return this.withStore('readwrite', async store => {
      const record = createRecord(normalized, content)
      await requestToPromise(store.add(record))
      return recordToWriteResult(record)
    })
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizePath(path)
    const placeholderPath = `${normalized}/${FOLDER_PLACEHOLDER}`
    await this.withStore('readwrite', async store => {
      const records = await requestToPromise(store.getAll())
      if (records.some(record => record.path === normalized || record.path.startsWith(`${normalized}/`))) {
        throw new Error(`Path already exists: ${normalized}`)
      }
      await requestToPromise(store.add(createRecord(placeholderPath, '')))
    })
  }

  async rename(oldPath: string, newPath: string, isDir: boolean): Promise<void> {
    const oldNormalized = normalizePath(oldPath)
    const newNormalized = normalizePath(newPath)
    if (oldNormalized === newNormalized) throw new Error(`Path already exists: ${newNormalized}`)
    if (isDir && newNormalized.startsWith(`${oldNormalized}/`)) {
      throw new Error('Cannot rename a folder into itself')
    }

    await this.withStore('readwrite', async store => {
      const records = await requestToPromise(store.getAll())
      const source = isDir
        ? records.filter(record => record.path.startsWith(`${oldNormalized}/`))
        : records.filter(record => record.path === oldNormalized)
      if (source.length === 0) throw new Error(`Path not found: ${oldNormalized}`)

      const sourcePaths = new Set(source.map(record => record.path))
      const destinationPaths = source.map(record =>
        isDir ? `${newNormalized}/${record.path.slice(oldNormalized.length + 1)}` : newNormalized,
      )
      const occupied = records.some(record => !sourcePaths.has(record.path) && (record.path === newNormalized || record.path.startsWith(`${newNormalized}/`)))
      if (occupied || new Set(destinationPaths).size !== destinationPaths.length) {
        throw new Error(`Path already exists: ${newNormalized}`)
      }

      for (let index = 0; index < source.length; index += 1) {
        await requestToPromise(store.add(createRecord(destinationPaths[index], source[index].content, source[index].updatedAt)))
      }
      for (const record of source) await requestToPromise(store.delete(record.path))
    })
  }

  async deleteFile(path: string, isDir: boolean): Promise<void> {
    const normalized = normalizePath(path)
    await this.withStore('readwrite', async store => {
      if (isDir) {
        const records = await requestToPromise(store.getAll())
        const targets = records.filter(record => record.path === normalized || record.path.startsWith(`${normalized}/`))
        if (targets.length === 0) throw new Error(`Path not found: ${normalized}`)
        for (const record of targets) await requestToPromise(store.delete(record.path))
      } else {
        const existing = await requestToPromise(store.get(normalized))
        if (!existing) throw new Error(`File not found: ${normalized}`)
        await requestToPromise(store.delete(normalized))
      }
    })
  }

  private async withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open()
    const tx = db.transaction(STORE_NAME, mode)
    const result = await fn(tx.objectStore(STORE_NAME))
    await transactionDone(tx)
    return result
  }

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'path' })
          store.createIndex('updatedAt', 'updatedAt')
        }
      }
      request.onsuccess = () => resolve(request.result)
    })
    return this.dbPromise
  }
}

function createRecord(path: string, content: string, previousUpdatedAt = 0): NoteRecord {
  const updatedAt = nextTimestamp(previousUpdatedAt)
  return {
    path,
    name: fileName(path),
    content,
    updatedAt,
    size: new TextEncoder().encode(content).byteLength,
  }
}

function nextTimestamp(previousUpdatedAt: number): number {
  lastTimestamp = Math.max(Date.now(), previousUpdatedAt + 1, lastTimestamp + 1)
  return lastTimestamp
}

function recordToEntry(record: NoteRecord): VaultEntry {
  return {
    name: record.name,
    path: record.path,
    type: 'file',
    mtime: record.updatedAt,
    size: record.size,
  }
}

function recordToWriteResult(record: NoteRecord): FileWriteResult {
  return {
    path: record.path,
    mtime: record.updatedAt,
    size: record.size,
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
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
