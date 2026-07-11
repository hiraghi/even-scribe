export interface VaultEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  mtime: number
  size: number
}

export interface TreeResult {
  path: string
  entries: VaultEntry[]
}

export interface FileResult {
  path: string
  content: string
  mtime: number
  size: number
}

export interface FileWriteResult {
  path: string
  mtime: number
  size: number
}

export interface VaultStorage {
  recent(limit: number, sinceDays?: number): Promise<VaultEntry[]>
  tree(path: string): Promise<TreeResult>
  file(path: string): Promise<FileResult>
  saveFile(path: string, content: string, baseMtime?: number): Promise<FileWriteResult>
  createFile(path: string, content: string): Promise<FileWriteResult>
}
