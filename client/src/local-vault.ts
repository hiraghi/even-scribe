import type { FileResult, FileWriteResult, TreeResult, VaultEntry, VaultStorage } from '@eveng2/g2-core'

const DB_NAME = 'even-scribe'
const DB_VERSION = 1
const STORE_NAME = 'notes'
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
