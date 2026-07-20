import type { KeyValueStorage } from '@eveng2/g2-core'

interface NativeStorageBridge {
  getLocalStorage(key: string): Promise<string>
  setLocalStorage(key: string, value: string): Promise<boolean>
}

export interface AppPersistence extends KeyValueStorage {
  readonly isNative: boolean
}

export class BrowserPersistence implements AppPersistence {
  readonly isNative = false

  async get(key: string): Promise<string> {
    try {
      return window.localStorage.getItem(key) ?? ''
    } catch (error) {
      console.warn(`Browser storage read failed: ${key}`, error)
      return ''
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    try {
      window.localStorage.setItem(key, value)
      return true
    } catch (error) {
      console.warn(`Browser storage write failed: ${key}`, error)
      return false
    }
  }
}

export class NativePersistence implements AppPersistence {
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

/**
 * Keeps small user state in both persistence domains. Native KV is preferred
 * when present, while browser storage preserves state in simulator hosts whose
 * native bridge is scoped to a single process.
 */
export class MirroredPersistence implements AppPersistence {
  readonly isNative = true

  constructor(
    private readonly native: KeyValueStorage,
    private readonly browser: KeyValueStorage,
  ) {}

  async get(key: string): Promise<string> {
    try {
      const nativeValue = await this.native.get(key)
      if (nativeValue !== '') return nativeValue
    } catch (error) {
      console.warn(`Native storage read failed: ${key}`, error)
    }
    return this.browser.get(key)
  }

  async set(key: string, value: string): Promise<boolean> {
    const [native, browser] = await Promise.allSettled([this.native.set(key, value), this.browser.set(key, value)])
    const nativeSaved = settledBoolean(native, `Native storage write failed: ${key}`)
    const browserSaved = settledBoolean(browser, `Browser storage write failed: ${key}`)
    return nativeSaved || browserSaved
  }
}

export function createAppPersistence(bridge: unknown): AppPersistence {
  const native = createNativePersistence(bridge)
  if (native) return new MirroredPersistence(native, new BrowserPersistence())
  return new BrowserPersistence()
}

export function createNativePersistence(bridge: unknown): NativePersistence | null {
  return hasNativeStorage(bridge) ? new NativePersistence(bridge) : null
}

function settledBoolean(result: PromiseSettledResult<boolean>, message: string): boolean {
  if (result.status === 'fulfilled') {
    if (!result.value) console.warn(message)
    return result.value
  }
  console.warn(message, result.reason)
  return false
}

function hasNativeStorage(bridge: unknown): bridge is NativeStorageBridge {
  if (!bridge || typeof bridge !== 'object') return false
  const candidate = bridge as Partial<NativeStorageBridge>
  return typeof candidate.getLocalStorage === 'function' && typeof candidate.setLocalStorage === 'function'
}
