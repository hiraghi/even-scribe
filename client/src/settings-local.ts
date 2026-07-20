import type { KeyValueStorage } from '@eveng2/g2-core'

export const DEFAULT_NEW_NOTE_DIR = ''

export interface LocalSettings {
  convStyle: 'classic' | 'live'
}

const SETTINGS_KEY = 'even-scribe.settings'

export async function loadLocalSettings(storage?: KeyValueStorage): Promise<LocalSettings> {
  try {
    const raw = storage ? await storage.get(SETTINGS_KEY) : window.localStorage.getItem(SETTINGS_KEY) ?? ''
    const parsed = JSON.parse(raw || '{}') as Partial<LocalSettings>
    return { convStyle: parsed.convStyle === 'live' ? 'live' : 'classic' }
  } catch {
    return { convStyle: 'classic' }
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
  select.value = initial.convStyle
  select.addEventListener('change', () => onSave({ convStyle: select.value === 'live' ? 'live' : 'classic' }))

  label.append(select)
  container.append(label)
}
