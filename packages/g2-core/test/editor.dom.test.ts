// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountEditor, type EditorHandle } from '../src/editor'
import { g2LineEdge, moveOffsetByG2Line } from '../src/glasses'

let editor: EditorHandle | null = null

afterEach(() => {
  editor?.unmount()
  editor = null
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('mountEditor DOM behavior', () => {
  it('focuses the textarea synchronously after mount', () => {
    const container = document.createElement('div')
    document.body.append(container)

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 0 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect(document.activeElement).toBe(textarea)
  })

  it('toggles and routes kana IME keys without mutating the textarea', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onImeToggle = vi.fn()
    const onImeKey = vi.fn()

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 0 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
        onImeToggle,
        onImeKey,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true }))
    editor.setImeMode('kana')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true }))
    editor.setImeComposingActive(true)
    editor.setImeCandidatesVisible(true)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))

    expect(onImeToggle).toHaveBeenCalledOnce()
    expect(onImeKey).toHaveBeenNthCalledWith(1, 'k')
    expect(onImeKey).toHaveBeenNthCalledWith(2, 'ArrowDown')
    expect(textarea.value).toBe('body')
  })

  it('passes editing keys through in kana mode when IME composition is inactive', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onImeKey = vi.fn()

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 4 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
        onImeKey,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    editor.setImeMode('kana')
    const backspace = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })

    textarea.dispatchEvent(backspace)
    textarea.dispatchEvent(enter)

    expect(onImeKey).not.toHaveBeenCalled()
    expect(backspace.defaultPrevented).toBe(false)
    expect(enter.defaultPrevented).toBe(false)
  })

  it('routes editing keys to kana IME while composition is active', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onImeKey = vi.fn()

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 4 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
        onImeKey,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    editor.setImeMode('kana')
    editor.setImeComposingActive(true)
    const backspace = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })

    textarea.dispatchEvent(backspace)
    textarea.dispatchEvent(enter)

    expect(onImeKey).toHaveBeenNthCalledWith(1, 'Backspace')
    expect(onImeKey).toHaveBeenNthCalledWith(2, 'Enter')
    expect(backspace.defaultPrevented).toBe(true)
    expect(enter.defaultPrevented).toBe(true)
  })

  it('routes composition-starting character keys to kana IME while inactive', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onImeKey = vi.fn()

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 4 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
        onImeKey,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    editor.setImeMode('kana')
    const event = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true })
    textarea.dispatchEvent(event)

    expect(onImeKey).toHaveBeenCalledWith('k')
    expect(event.defaultPrevented).toBe(true)
  })

  it('routes Space and shift+letters to kana IME while inactive', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onImeKey = vi.fn()

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 4 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
        onImeKey,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    editor.setImeMode('kana')
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    const latin = new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true, cancelable: true })
    textarea.dispatchEvent(space)
    textarea.dispatchEvent(latin)

    expect(onImeKey).toHaveBeenNthCalledWith(1, 'Space')
    expect(onImeKey).toHaveBeenNthCalledWith(2, 'Latin:A')
    expect(space.defaultPrevented).toBe(true)
    expect(latin.defaultPrevented).toBe(true)
  })

  it('handles Japanese keyboard IME mode keys', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onImeToggle = vi.fn()
    const onImeSetMode = vi.fn()

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 0 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
        onImeToggle,
        onImeSetMode,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    const convert = new KeyboardEvent('keydown', { key: 'Convert', bubbles: true, cancelable: true })
    const nonConvert = new KeyboardEvent('keydown', { key: 'NonConvert', bubbles: true, cancelable: true })
    const zenkakuHankaku = new KeyboardEvent('keydown', { key: 'ZenkakuHankaku', bubbles: true, cancelable: true })

    textarea.dispatchEvent(convert)
    textarea.dispatchEvent(nonConvert)
    textarea.dispatchEvent(zenkakuHankaku)

    expect(onImeSetMode).toHaveBeenNthCalledWith(1, 'kana')
    expect(onImeSetMode).toHaveBeenNthCalledWith(2, 'direct')
    expect(onImeToggle).toHaveBeenCalledOnce()
    expect(convert.defaultPrevented).toBe(true)
    expect(nonConvert.defaultPrevented).toBe(true)
    expect(zenkakuHankaku.defaultPrevented).toBe(true)
  })

  it('updates the companion IME mode indicator when mode changes', () => {
    const container = document.createElement('div')
    document.body.append(container)

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'body', cursorOffset: 0 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
      },
    )

    const indicator = container.querySelector('.editor-ime-mode')
    expect(indicator).not.toBeNull()
    expect(indicator?.textContent).toBe('A')

    editor.setImeMode('kana')
    expect(indicator?.textContent).toBe('あ')

    editor.setImeMode('direct')
    expect(indicator?.textContent).toBe('A')
  })

  it('moves ArrowDown by G2 wrapped line units and emits the selection', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onInput = vi.fn()
    const content = 'abc\ndef'

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content, cursorOffset: 1 },
      {
        onInput,
        onSave: () => undefined,
        onDiscard: () => undefined,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))

    const expectedOffset = moveOffsetByG2Line(content, 1, 1)
    expect(textarea.selectionStart).toBe(expectedOffset)
    expect(onInput).toHaveBeenCalledWith({
      draft: content,
      cursor: { offset: expectedOffset, line: 2, col: 2 },
      composing: undefined,
    })
  })

  it('pages by G2 screen rows (LIST_BODY_ROWS) on PageUp instead of the textarea default', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onInput = vi.fn()
    const content = Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n')
    const startOffset = content.length // カーソルは最終行

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content, cursorOffset: startOffset },
      {
        onInput,
        onSave: () => undefined,
        onDiscard: () => undefined,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    const pageUp = new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true })
    textarea.dispatchEvent(pageUp)

    const expectedOffset = moveOffsetByG2Line(content, startOffset, -7)
    expect(pageUp.defaultPrevented).toBe(true)
    expect(textarea.selectionStart).toBe(expectedOffset)
    expect(onInput).toHaveBeenCalled()
  })

  it('moves Home and End by G2 display line edges', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onInput = vi.fn()
    const content = 'abcdefghij'
    const startOffset = 7

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content, cursorOffset: startOffset },
      {
        onInput,
        onSave: () => undefined,
        onDiscard: () => undefined,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    const home = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    textarea.dispatchEvent(home)

    const homeOffset = g2LineEdge(content, startOffset, 'home')
    expect(home.defaultPrevented).toBe(true)
    expect(textarea.selectionStart).toBe(homeOffset)

    const end = new KeyboardEvent('keydown', { key: 'End', shiftKey: true, bubbles: true, cancelable: true })
    textarea.dispatchEvent(end)
    const endOffset = g2LineEdge(content, homeOffset, 'end')
    expect(end.defaultPrevented).toBe(true)
    expect(textarea.selectionStart).toBe(homeOffset)
    expect(textarea.selectionEnd).toBe(endOffset)
    expect(onInput).toHaveBeenCalled()
  })

  it('extends the selection with shift+ArrowDown and reports the anchor', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onInput = vi.fn()
    const content = 'abc\ndef'

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content, cursorOffset: 1 },
      {
        onInput,
        onSave: () => undefined,
        onDiscard: () => undefined,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }))

    const expectedHead = moveOffsetByG2Line(content, 1, 1)
    expect(textarea.selectionStart).toBe(1)
    expect(textarea.selectionEnd).toBe(expectedHead)
    expect(onInput).toHaveBeenCalledWith({
      draft: content,
      cursor: { offset: expectedHead, line: 2, col: 2 },
      composing: undefined,
      selAnchor: 1,
    })
  })

  it('restores a selection range via setContent instead of collapsing it', () => {
    const container = document.createElement('div')
    document.body.append(container)

    editor = mountEditor(
      container,
      { path: 'note.md', baseMtime: 1, content: 'abc\ndef', cursorOffset: 0 },
      {
        onInput: () => undefined,
        onSave: () => undefined,
        onDiscard: () => undefined,
      },
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    if (!textarea) return

    editor.setContent('abc\ndef', 5, 1)
    expect(textarea.selectionStart).toBe(1)
    expect(textarea.selectionEnd).toBe(5)

    editor.setContent('abc\ndef', 1, 5)
    expect(textarea.selectionStart).toBe(1)
    expect(textarea.selectionEnd).toBe(5)
    expect(textarea.selectionDirection).toBe('backward')

    editor.setContent('abc\ndef', 2)
    expect(textarea.selectionStart).toBe(2)
    expect(textarea.selectionEnd).toBe(2)
  })
})
