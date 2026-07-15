// Test-only replacement for `@evenrealities/even_hub_sdk`, wired in via
// `vite.acceptance.config.ts`. It implements ONLY the native-host boundary — the
// one part of the app that cannot exist in a plain browser (on real hardware /
// the Tauri simulator a native host injects `window.EvenAppBridge`). Every other
// line of the app (main.ts orchestration, reducer, formatScreen, editor, VaultApi)
// runs for real, so this harness catches wiring / runtime / render gaps that unit
// tests skip.
//
// The enum values and value-classes below mirror the real SDK surface that the app
// imports (main.ts + packages/g2-core/src/glasses.ts). Keep them in sync if the SDK
// bridge contract changes.

export enum OsEventTypeList {
  CLICK_EVENT = 0,
  SCROLL_TOP_EVENT = 1,
  SCROLL_BOTTOM_EVENT = 2,
  DOUBLE_CLICK_EVENT = 3,
  FOREGROUND_ENTER_EVENT = 4,
  FOREGROUND_EXIT_EVENT = 5,
  ABNORMAL_EXIT_EVENT = 6,
  SYSTEM_EXIT_EVENT = 7,
  IMU_DATA_REPORT = 8,
}

// Value-classes used with `new` in packages/g2-core/src/glasses.ts. The mock only
// needs to be constructible and hold the payload; the mock bridge no-ops on them.
export class CreateStartUpPageContainer {
  constructor(public readonly props: unknown) {}
}
export class TextContainerProperty {
  constructor(public readonly props: unknown) {}
}
export class TextContainerUpgrade {
  constructor(public readonly props: unknown) {}
}

export interface EvenHubEvent {
  listEvent?: { eventType?: number; currentSelectItemIndex?: number }
  sysEvent?: { eventType?: number }
  textEvent?: { eventType?: number }
}

export interface EvenAppBridge {
  createStartUpPageContainer(container: unknown): Promise<number>
  textContainerUpgrade(container: unknown): Promise<boolean>
  shutDownPageContainer(exitMode?: number): Promise<boolean>
  getLocalStorage(key: string): Promise<string>
  setLocalStorage(key: string, value: string): Promise<boolean>
  onEvenHubEvent(callback: (event: EvenHubEvent) => void): () => void
}

declare global {
  interface Window {
    // Lets a scenario drive the glasses input path (touchpad gestures) rather than
    // the keyboard path, by pushing real SDK-shaped events into the app.
    __emitEvenHubEvent?: (event: EvenHubEvent) => void
    // Exposes the most recent text pushed to the glasses container, so tests can
    // assert on exactly what the firmware would render.
    __lastGlassesText?: string
  }
}

function createMockBridge(): EvenAppBridge {
  const listeners = new Set<(event: EvenHubEvent) => void>()
  window.__emitEvenHubEvent = (event: EvenHubEvent) => {
    for (const cb of listeners) cb(event)
  }
  return {
    async createStartUpPageContainer() {
      return 0
    },
    async textContainerUpgrade(container: unknown) {
      const props = (container as { props?: { content?: unknown } })?.props
      if (props && typeof props.content === 'string') window.__lastGlassesText = props.content
      return true
    },
    async shutDownPageContainer() {
      return true
    },
    async getLocalStorage(key: string) {
      return window.localStorage.getItem(key) ?? ''
    },
    async setLocalStorage(key: string, value: string) {
      window.localStorage.setItem(key, value)
      return true
    },
    onEvenHubEvent(callback: (event: EvenHubEvent) => void) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
  }
}

let bridge: EvenAppBridge | null = null

export function waitForEvenAppBridge(): Promise<EvenAppBridge> {
  if (!bridge) bridge = createMockBridge()
  return Promise.resolve(bridge)
}
