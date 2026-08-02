import type { KeyValueStorage } from '@eveng2/g2-core'

export const DEFAULT_NEW_NOTE_DIR = ''

export interface LocalSettings {
  convStyle: 'classic' | 'live'
  keyDebug: boolean
}

const SETTINGS_KEY = 'even-scribe.settings'

export async function loadLocalSettings(storage?: KeyValueStorage): Promise<LocalSettings> {
  try {
    const raw = storage ? await storage.get(SETTINGS_KEY) : window.localStorage.getItem(SETTINGS_KEY) ?? ''
    const parsed = JSON.parse(raw || '{}') as Partial<LocalSettings>
    return {
      convStyle: parsed.convStyle === 'live' ? 'live' : 'classic',
      keyDebug: parsed.keyDebug === true,
    }
  } catch {
    return { convStyle: 'classic', keyDebug: false }
  }
}

export async function saveLocalSettings(settings: LocalSettings, storage?: KeyValueStorage): Promise<void> {
  if (storage) {
    await storage.set(SETTINGS_KEY, JSON.stringify(settings))
    return
  }
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function mountLocalSettingsUi(container: HTMLElement, initial: LocalSettings, onSave: (settings: LocalSettings) => void): void {
  const label = document.createElement('label')
  label.htmlFor = 'ime-conv-style'
  label.textContent = 'IME conversion: '

  const select = document.createElement('select')
  select.id = 'ime-conv-style'
  for (const [value, text] of [
    ['classic', 'Classic IME (Space to convert)'],
    ['live', 'Live suggestions'],
  ] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    select.append(option)
  }
  const keyDebugLabel = document.createElement('label')
  keyDebugLabel.htmlFor = 'key-debug-log'
  keyDebugLabel.textContent = 'Key debug log: '

  const keyDebug = document.createElement('input')
  keyDebug.id = 'key-debug-log'
  keyDebug.type = 'checkbox'
  keyDebug.checked = initial.keyDebug

  const save = () => onSave({
    convStyle: select.value === 'live' ? 'live' : 'classic',
    keyDebug: keyDebug.checked,
  })

  select.value = initial.convStyle
  select.addEventListener('change', save)
  keyDebug.addEventListener('change', save)

  label.append(select)
  keyDebugLabel.append(keyDebug)
  container.append(label, keyDebugLabel)
}
