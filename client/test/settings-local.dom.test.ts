// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { loadLocalSettings, mountLocalSettingsUi, saveLocalSettings } from '../src/settings-local'

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
})

describe('local settings', () => {
  it('defaults to classic and persists the live setting selected in the shell', async () => {
    expect(await loadLocalSettings()).toEqual({ convStyle: 'classic' })

    const container = document.createElement('div')
    document.body.append(container)
    let saved: { convStyle: 'classic' | 'live' } = { convStyle: 'classic' }
    mountLocalSettingsUi(container, saved, settings => {
      saved = settings
      void saveLocalSettings(settings)
    })

    const select = container.querySelector<HTMLSelectElement>('#ime-conv-style')
    if (!select) throw new Error('missing conversion style select')
    select.value = 'live'
    select.dispatchEvent(new Event('change'))

    expect(saved).toEqual({ convStyle: 'live' })
    expect(await loadLocalSettings()).toEqual({ convStyle: 'live' })
  })
})
