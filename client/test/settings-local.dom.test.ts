// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { loadLocalSettings, mountLocalSettingsUi, saveLocalSettings, type LocalSettings } from '../src/settings-local'

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
})

describe('local settings', () => {
  it('defaults to classic with key logging disabled and persists settings selected in the shell', async () => {
    expect(await loadLocalSettings()).toEqual({ convStyle: 'classic', keyDebug: false })

    const container = document.createElement('div')
    document.body.append(container)
    let saved: LocalSettings = { convStyle: 'classic', keyDebug: false }
    mountLocalSettingsUi(container, saved, settings => {
      saved = settings
      void saveLocalSettings(settings)
    })

    const select = container.querySelector<HTMLSelectElement>('#ime-conv-style')
    if (!select) throw new Error('missing conversion style select')
    select.value = 'live'
    select.dispatchEvent(new Event('change'))

    const keyDebug = container.querySelector<HTMLInputElement>('#key-debug-log')
    if (!keyDebug) throw new Error('missing key debug log checkbox')
    keyDebug.checked = true
    keyDebug.dispatchEvent(new Event('change'))

    expect(saved).toEqual({ convStyle: 'live', keyDebug: true })
    expect(await loadLocalSettings()).toEqual({ convStyle: 'live', keyDebug: true })
  })
})
