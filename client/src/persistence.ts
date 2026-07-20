import type { KeyValueStorage } from '@eveng2/g2-core'

interface NativeStorageBridge {
  getLocalStorage(key: string): Promise<string>
  setLocalStorage(key: string, value: string): Promise<boolean>
}

export interface AppPersistence extends KeyValueStorage {
  readonly isNative: boolean
}

class BrowserPersistence implements AppPersistence {
  readonly isNative = false

  async get(key: string): Promise<string> {
    return window.localStorage.getItem(key) ?? ''
  }

  async set(key: string, value: string): Promise<boolean> {
    window.localStorage.setItem(key, value)
    return true
  }
}

class NativePersistence implements AppPersistence {
  readonly isNative = true

  constructor(private readonly bridge: NativeStorageBridge) {}

  async get(key: string): Promise<string> {
    try {
      return await this.bridge.getLocalStorage(key)
    } catch (error) {
      console.warn(`Native storage read failed: ${key}`, error)
      return ''
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    try {
      const saved = await this.bridge.setLocalStorage(key, value)
      if (!saved) console.warn(`Native storage write failed: ${key}`)
      return saved
    } catch (error) {
      console.warn(`Native storage write failed: ${key}`, error)
      return false
    }
  }
}

export function createAppPersistence(bridge: unknown): AppPersistence {
  if (hasNativeStorage(bridge)) return new NativePersistence(bridge)
  return new BrowserPersistence()
}

function hasNativeStorage(bridge: unknown): bridge is NativeStorageBridge {
  if (!bridge || typeof bridge !== 'object') return false
  const candidate = bridge as Partial<NativeStorageBridge>
  return typeof candidate.getLocalStorage === 'function' && typeof candidate.setLocalStorage === 'function'
}
