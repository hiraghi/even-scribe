import { describe, expect, it } from 'vitest'
import { createInitialState, reduce, type AppState, type EditState } from '../src/state'
import type { VaultEntry } from '../src/storage'

const recentEntries: VaultEntry[] = [
  { name: 'a.md', path: 'a.md', type: 'file', mtime: 3, size: 10 },
  { name: 'b.md', path: 'b.md', type: 'file', mtime: 2, size: 10 },
]

const treeEntries: VaultEntry[] = [
  { name: 'folder', path: 'folder', type: 'dir', mtime: 3, size: 0 },
  { name: 'note.md', path: 'note.md', type: 'file', mtime: 2, size: 10 },
]

function loadedRecent(): AppState {
  return reduce(createInitialState(), { type: 'loadedRecent', entries: recentEntries }).state
}

describe('state reducer', () => {
  it('moves RECENT selection down and clamps at the bottom', () => {
    const first = reduce(loadedRecent(), { type: 'scrollDown' }).state
    expect(first.current.mode).toBe('list')
    if (first.current.mode === 'list') expect(first.current.selectedIndex).toBe(1)

    const second = reduce(first, { type: 'scrollDown' }).state
    const third = reduce(second, { type: 'scrollDown' }).state
    const fourth = reduce(third, { type: 'scrollDown' }).state
    if (fourth.current.mode === 'list') expect(fourth.current.selectedIndex).toBe(2)
  })

  it('opens TREE root when clicking RECENT browse item', () => {
    const result = reduce(loadedRecent(), { type: 'click' })
    expect(result.effect).toEqual({ kind: 'openTree', path: '' })
    expect(result.state.stack).toHaveLength(1)
  })

  it('pushes stack and requests child TREE when clicking a directory', () => {
    const clicked = reduce(loadedRecent(), { type: 'click' })
    const tree = reduce(clicked.state, { type: 'loadedTree', path: '', entries: treeEntries }).state
    const result = reduce(tree, { type: 'click' })
    expect(result.effect).toEqual({ kind: 'openTree', path: 'folder' })
    expect(result.state.stack).toHaveLength(2)
  })

  it('pushes stack and requests a file open when clicking a file', () => {
    const clicked = reduce(loadedRecent(), { type: 'click' })
    const tree = reduce(clicked.state, { type: 'loadedTree', path: '', entries: treeEntries }).state
    const selectedFile = reduce(tree, { type: 'scrollDown' }).state
    const result = reduce(selectedFile, { type: 'click' })
    expect(result.effect).toEqual({ kind: 'openFile', path: 'note.md' })
    expect(result.state.stack).toHaveLength(2)
  })

  it('emits createFolder and rename effects for name-dialog actions', () => {
    expect(reduce(loadedRecent(), { type: 'createNote', path: 'notes/new.md' }).effect).toEqual({
      kind: 'createNote',
      path: 'notes/new.md',
    })
    expect(reduce(loadedRecent(), { type: 'createFolder', path: 'notes/empty' }).effect).toEqual({
      kind: 'createFolder',
      path: 'notes/empty',
    })
    expect(reduce(loadedRecent(), { type: 'rename', oldPath: 'notes/old.md', newPath: 'notes/new.md', isDir: false }).effect).toEqual({
      kind: 'rename',
      oldPath: 'notes/old.md',
      newPath: 'notes/new.md',
      isDir: false,
    })
  })

  it('confirms deletion of the selected file and emits a deleteFile effect', () => {
    const selected = reduce(loadedRecent(), { type: 'scrollDown' }).state
    const requested = reduce(selected, { type: 'requestDelete' })

    expect(requested.state.current.mode).toBe('confirm-delete')
    if (requested.state.current.mode === 'confirm-delete') expect(requested.state.current.selected).toBe(1)

    const confirmed = reduce(reduce(requested.state, { type: 'scrollDown' }).state, { type: 'click' })
    expect(confirmed.effect).toEqual({ kind: 'deleteFile', path: 'a.md', isDir: false })
    expect(confirmed.state.current.mode).toBe('list')
  })

  it('confirms name input with the matching create effect and returns to the list', () => {
    const opened = reduce(loadedRecent(), {
      type: 'startNameInput',
      kind: 'new-file',
      label: 'New file name',
      directory: 'drafts',
    }).state
    const typed = reduce(opened, {
      type: 'editInput',
      draft: 'new note',
      cursor: { offset: 8, line: 1, col: 9 },
    }).state
    const confirmed = reduce(typed, { type: 'submitNameInput' })

    expect(confirmed.effect).toEqual({ kind: 'createNote', path: 'drafts/new note.md' })
    expect(confirmed.state.current.mode).toBe('list')
    expect(confirmed.state.stack).toHaveLength(0)
  })

  it('cancels name input and refuses newlines', () => {
    const opened = reduce(loadedRecent(), {
      type: 'startNameInput',
      kind: 'new-folder',
      label: 'New folder name',
      directory: '',
    }).state
    const typed = reduce(opened, {
      type: 'editInput',
      draft: 'one\ntwo',
      cursor: { offset: 7, line: 2, col: 4 },
    }).state

    expect(typed.current.mode).toBe('name-input')
    if (typed.current.mode === 'name-input') expect(typed.current.buffer).toBe('onetwo')

    const cancelled = reduce(typed, { type: 'cancelNameInput' })
    expect(cancelled.effect).toEqual({ kind: 'none' })
    expect(cancelled.state.current.mode).toBe('list')
  })

  it('uses the name-input IME before confirming a rename', () => {
    const opened = reduce(loadedRecent(), {
      type: 'startNameInput',
      kind: 'rename',
      label: 'Rename',
      directory: '',
      buffer: 'old',
      targetPath: 'old.md',
      isDir: false,
    }).state
    const kana = reduce(opened, { type: 'imeToggle' }).state
    const typed = reduce(reduce(kana, { type: 'imeKey', key: 'k' }).state, { type: 'imeKey', key: 'a' }).state
    const committed = reduce(typed, { type: 'imeKey', key: 'Enter' }).state
    const renamed = reduce(committed, { type: 'submitNameInput' })

    expect(opened.current.mode).toBe('name-input')
    if (opened.current.mode === 'name-input') expect(opened.current.selAnchor).toBe(0)
    expect(renamed.effect).toEqual({ kind: 'rename', oldPath: 'old.md', newPath: 'か.md', isDir: false })
  })

  it('treats an unchanged rename name as cancel (no rename effect)', () => {
    const opened = reduce(loadedRecent(), {
      type: 'startNameInput',
      kind: 'rename',
      label: 'Rename',
      directory: '',
      buffer: 'note',
      targetPath: 'note.md',
      isDir: false,
    }).state
    const confirmed = reduce(opened, { type: 'submitNameInput' })

    expect(confirmed.effect).toEqual({ kind: 'none' })
    expect(confirmed.state.current.mode).toBe('list')
  })

  it('hides non-markdown files from tree lists and refuses to open them defensively', () => {
    const clicked = reduce(loadedRecent(), { type: 'click' })
    const tree = reduce(clicked.state, {
      type: 'loadedTree',
      path: '',
      entries: [...treeEntries, { name: 'image.png', path: 'image.png', type: 'file', mtime: 1, size: 100 }],
    }).state

    expect(tree.current.mode).toBe('list')
    if (tree.current.mode === 'list') {
      expect(tree.current.items.map(item => item.label)).toEqual(['folder', 'note.md'])
    }

    const unsafe: AppState = {
      ...tree,
      current: {
        mode: 'list',
        kind: 'tree',
        title: 'TREE',
        path: '',
        items: [{ label: 'image.png', kind: 'file', path: 'image.png' }],
        selectedIndex: 0,
      },
    }
    const result = reduce(unsafe, { type: 'click' })
    expect(result.effect).toEqual({ kind: 'none' })
    expect(result.state.stack).toHaveLength(tree.stack.length)
  })

  it('loadedFile opens EDIT directly and preserves frontmatter', () => {
    const rawContent = '---\ntitle: Raw\n---\n# Body'
    const result = reduce(loadedRecent(), {
      type: 'loadedFile',
      path: 'a.md',
      rawContent,
      mtime: 99,
    })

    expect(result.effect).toEqual({ kind: 'none' })
    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') {
      expect(result.state.current.draft).toBe(rawContent)
      expect(result.state.current.baseMtime).toBe(99)
      expect(result.state.current.cursor).toEqual({ offset: 0, line: 1, col: 1 })
      expect(result.state.current.dirty).toBe(false)
    }
  })

  it('syncs LIST selection from listSelect and ignores it outside LIST', () => {
    const result = reduce(loadedRecent(), { type: 'listSelect', index: 2 })

    expect(result.effect).toEqual({ kind: 'none' })
    expect(result.state.current.mode).toBe('list')
    if (result.state.current.mode === 'list') expect(result.state.current.selectedIndex).toBe(2)

    const edit = openEdit()
    const editResult = reduce(edit, { type: 'listSelect', index: 2 })
    expect(editResult.state.current).toEqual(edit.current)
    expect(editResult.effect).toEqual({ kind: 'none' })
  })

  it('restores the previous list and reloads it on doubleClick when stack is not empty', () => {
    const initial = loadedRecent()
    const clicked = reduce(initial, { type: 'click' })
    const tree = reduce(clicked.state, { type: 'loadedTree', path: '', entries: treeEntries }).state
    const result = reduce(tree, { type: 'doubleClick' })
    expect(result.state.current).toEqual(initial.current)
    expect(result.state.stack).toHaveLength(0)
    // 戻り先の RECENT を再読込する: 別画面(TREE)でのフォルダ削除後も一覧が最新化される
    expect(result.effect).toEqual({ kind: 'openRecent' })
  })

  it('requests parent TREE on doubleClick from a nested tree path', () => {
    const state: AppState = {
      current: {
        mode: 'list',
        kind: 'tree',
        title: 'TREE',
        path: 'a/b',
        items: [],
        selectedIndex: 0,
      },
      stack: [],
      exitRequested: false,
    }

    const result = reduce(state, { type: 'doubleClick' })

    expect(result.state).toBe(state)
    expect(result.effect).toEqual({ kind: 'openTree', path: 'a' })
  })

  it('requests RECENT reload on TREE root or RECENT doubleClick with an empty stack', () => {
    const treeRoot: AppState = {
      current: {
        mode: 'list',
        kind: 'tree',
        title: 'TREE',
        path: '',
        items: [],
        selectedIndex: 0,
      },
      stack: [],
      exitRequested: false,
    }

    expect(reduce(treeRoot, { type: 'doubleClick' }).effect).toEqual({ kind: 'openRecent' })
    expect(reduce(loadedRecent(), { type: 'doubleClick' }).effect).toEqual({ kind: 'openRecent' })
  })

  it('marks editInput dirty, stores cursor/composition, and keeps the cursor inside the sticky viewport', () => {
    const edit = { ...openEdit(), current: { ...(openEdit().current as EditState), scrollLine: 3 } }
    const result = reduce(edit, {
      type: 'editInput',
      draft: 'hello',
      cursor: { offset: 5, line: 1, col: 6 },
      composing: 'かな',
    })

    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') {
      expect(result.state.current.dirty).toBe(true)
      expect(result.state.current.cursor).toEqual({ offset: 5, line: 1, col: 6 })
      expect(result.state.current.composing).toBe('かな')
      // 1行ドラフトなので stale な scrollLine=3 はカーソルが見える 0 に補正される
      expect(result.state.current.scrollLine).toBe(0)
    }
  })

  it('moves the EDIT cursor by logical lines while preserving column as much as possible', () => {
    const editCurrent: EditState = {
      mode: 'edit',
      title: 'note.md',
      path: 'note.md',
      baseMtime: 1,
      draft: 'abc\ndefg\nz',
      dirty: false,
      cursor: { offset: 1, line: 1, col: 2 },
      status: 'editing',
      scrollLine: null,
      ime: directIme(),
    }
    const state: AppState = { current: editCurrent, stack: [], exitRequested: false }

    const down = reduce(state, { type: 'scrollDown' }).state
    expect(down.current.mode).toBe('edit')
    if (down.current.mode === 'edit') expect(down.current.cursor).toEqual({ offset: 5, line: 2, col: 2 })

    const clampedToShortLine = reduce(down, { type: 'scrollDown' }).state
    expect(clampedToShortLine.current.mode).toBe('edit')
    if (clampedToShortLine.current.mode === 'edit') expect(clampedToShortLine.current.cursor).toEqual({ offset: 10, line: 3, col: 2 })
  })

  it('EDIT click closes clean files immediately and opens Save/Discard confirmation for dirty files', () => {
    const clean = openEdit()
    const cleanResult = reduce(clean, { type: 'click' })
    expect(cleanResult.state.current.mode).toBe('list')

    const dirty = reduce(openEdit(), {
      type: 'editInput',
      draft: 'changed',
      cursor: { offset: 7, line: 1, col: 8 },
    }).state

    const confirm = reduce(dirty, { type: 'click' })
    expect(confirm.state.current.mode).toBe('confirm-save')
    if (confirm.state.current.mode === 'confirm-save') {
      expect(confirm.state.current.selected).toBe(0)
      expect(confirm.state.current.edit.draft).toBe('changed')
    }
  })

  it('toggles Save/Discard confirmation selection and cancels back to editing', () => {
    const dirty = reduce(openEdit(), {
      type: 'editInput',
      draft: 'changed',
      cursor: { offset: 7, line: 1, col: 8 },
    }).state
    const confirm = reduce(dirty, { type: 'discardEdit' }).state
    const toggled = reduce(confirm, { type: 'scrollDown' }).state

    expect(toggled.current.mode).toBe('confirm-save')
    if (toggled.current.mode === 'confirm-save') expect(toggled.current.selected).toBe(1)

    const selectedByList = reduce(toggled, { type: 'listSelect', index: 0 }).state
    expect(selectedByList.current.mode).toBe('confirm-save')
    if (selectedByList.current.mode === 'confirm-save') expect(selectedByList.current.selected).toBe(0)

    const cancelled = reduce(selectedByList, { type: 'doubleClick' })
    expect(cancelled.effect).toEqual({ kind: 'none' })
    expect(cancelled.state.current.mode).toBe('edit')
    if (cancelled.state.current.mode === 'edit') expect(cancelled.state.current.draft).toBe('changed')
  })

  it('saves then leaves when Save is selected in the confirmation', () => {
    const dirty = reduce(openEdit(), {
      type: 'editInput',
      draft: 'changed',
      cursor: { offset: 7, line: 1, col: 8 },
    }).state
    const confirm = reduce(dirty, { type: 'discardEdit' }).state
    const saving = reduce(confirm, { type: 'click' })

    expect(saving.effect).toEqual({ kind: 'saveFile', path: 'a.md', content: 'changed', baseMtime: 99 })
    expect(saving.state.current.mode).toBe('edit')
    if (saving.state.current.mode === 'edit') expect(saving.state.current.exitAfterSave).toBe(true)

    const saved = reduce(saving.state, { type: 'saveDone', mtime: 123 })
    expect(saved.effect).toEqual({ kind: 'openRecent' })
    expect(saved.state.current.mode).toBe('list')
  })

  it('discards and leaves when Discard is selected in the confirmation', () => {
    const dirty = reduce(openEdit(), {
      type: 'editInput',
      draft: 'changed',
      cursor: { offset: 7, line: 1, col: 8 },
    }).state
    const confirm = reduce(dirty, { type: 'discardEdit' }).state
    const discard = reduce(reduce(confirm, { type: 'scrollDown' }).state, { type: 'click' })

    expect(discard.effect).toEqual({ kind: 'openRecent' })
    expect(discard.state.current.mode).toBe('list')
  })

  it('EDIT doubleClick requests saveFile or createFile', () => {
    const edit = reduce(openEdit(), {
      type: 'editInput',
      draft: 'changed',
      cursor: { offset: 7, line: 1, col: 8 },
    }).state
    const save = reduce(edit, { type: 'doubleClick' })

    expect(save.effect).toEqual({ kind: 'saveFile', path: 'a.md', content: 'changed', baseMtime: 99 })

    const created = reduce(
      reduce(loadedRecent(), {
        type: 'restoreDraft',
        path: 'drafts/new.md',
        baseMtime: 0,
        draft: '',
        cursor: { offset: 0, line: 1, col: 1 },
        isNew: true,
      }).state,
      { type: 'doubleClick' },
    )
    expect(created.effect).toEqual({ kind: 'createFile', path: 'drafts/new.md', content: '' })
  })

  it('classic kana IME waits for Space before lookup, then moves selection and commits', () => {
    const kana = reduce(openEdit(), { type: 'imeToggle' }).state
    const pending = reduce(kana, { type: 'imeKey', key: 'k' })
    expect(pending.effect).toEqual({ kind: 'none' })
    expect(pending.state.current.mode).toBe('edit')
    if (pending.state.current.mode === 'edit') {
      expect(pending.state.current.ime.pending).toBe('k')
      expect(pending.state.current.composing).toBe('k')
    }

    const typed = reduce(pending.state, { type: 'imeKey', key: 'a' })
    expect(typed.effect).toEqual({ kind: 'none' })
    expect(typed.state.current.mode).toBe('edit')
    if (typed.state.current.mode === 'edit') {
      expect(typed.state.current.ime.reading).toBe('か')
      expect(typed.state.current.ime.suggesting).toBe(false)
      expect(typed.state.current.composing).toBe('か')
    }

    const lookup = reduce(typed.state, { type: 'imeKey', key: 'Space' })
    expect(lookup.effect).toEqual({ kind: 'imeLookup', text: 'か', immediate: true })

    const candidates = reduce(lookup.state, { type: 'imeCandidates', text: 'か', candidates: ['蚊', '課'] }).state
    expect(candidates.current.mode).toBe('edit')
    if (candidates.current.mode === 'edit') {
      expect(candidates.current.ime.candidates).toEqual(['蚊', '課', 'カ', 'ka']) // カタカナ/英字候補を付与
      expect(candidates.current.ime.selected).toBe(0)
      expect(candidates.current.ime.suggesting).toBe(false)
    }

    const selected = reduce(candidates, { type: 'scrollDown' }).state
    expect(selected.current.mode).toBe('edit')
    if (selected.current.mode === 'edit') expect(selected.current.ime.selected).toBe(1)

    const committedResult = reduce(selected, { type: 'click' })
    expect(committedResult.effect).toEqual({ kind: 'imeLearn', reading: 'か', candidate: '課' })
    const committed = committedResult.state
    expect(committed.current.mode).toBe('edit')
    if (committed.current.mode === 'edit') {
      expect(committed.current.draft).toBe('課raw')
      expect(committed.current.cursor).toEqual({ offset: 1, line: 1, col: 2 })
      expect(committed.current.dirty).toBe(true)
      expect(committed.current.composing).toBeUndefined()
      expect(committed.current.ime).toEqual({ ...directIme(), mode: 'kana' })
    }
  })

  it('imeSetConvStyle changes the persisted edit style after committing active text', () => {
    const kana = reduce(openEdit(), { type: 'imeSetMode', mode: 'kana' }).state
    const composing = reduce(kana, { type: 'imeKey', key: 'k' }).state
    const result = reduce(composing, { type: 'imeSetConvStyle', convStyle: 'live' })

    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') {
      expect(result.state.current.ime.convStyle).toBe('live')
      expect(result.state.current.draft).toBe('kraw')
      expect(result.state.current.composing).toBeUndefined()
    }
  })

  it('allows live suggestions to be selected with glass scrolling', () => {
    const kana = reduce(reduce(openEdit(), { type: 'imeSetMode', mode: 'kana' }).state, { type: 'imeSetConvStyle', convStyle: 'live' }).state
    const pending = reduce(kana, { type: 'imeKey', key: 'k' }).state
    const typed = reduce(pending, { type: 'imeKey', key: 'a' })
    expect(typed.effect).toEqual({ kind: 'imeLookup', text: 'か', immediate: undefined })
    const candidates = reduce(typed.state, { type: 'imeCandidates', text: 'か', candidates: ['蚊', '課'] }).state
    const selected = reduce(candidates, { type: 'scrollDown' }).state

    expect(selected.current.mode).toBe('edit')
    if (selected.current.mode === 'edit') expect(selected.current.ime.selected).toBe(1)
  })

  it('imeSetMode switches to kana and resets IME state when the mode changes', () => {
    const result = reduce(openEdit(), { type: 'imeSetMode', mode: 'kana' })

    expect(result.effect).toEqual({ kind: 'none' })
    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') {
      expect(result.state.current.ime).toEqual({ ...directIme(), mode: 'kana' })
      expect(result.state.current.composing).toBeUndefined()
    }
  })

  it('imeSetMode leaves an active composition untouched when setting the same mode', () => {
    const kana = reduce(openEdit(), { type: 'imeSetMode', mode: 'kana' }).state
    const composing = reduce(kana, { type: 'imeKey', key: 'k' }).state
    const result = reduce(composing, { type: 'imeSetMode', mode: 'kana' })

    expect(result.state).toBe(composing)
    expect(result.effect).toEqual({ kind: 'none' })
    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') {
      expect(result.state.current.ime.pending).toBe('k')
      expect(result.state.current.composing).toBe('k')
    }
  })

  it('imeSetMode clears active composition when switching to direct', () => {
    const kana = reduce(openEdit(), { type: 'imeSetMode', mode: 'kana' }).state
    const composing = reduce(kana, { type: 'imeKey', key: 'k' }).state
    const result = reduce(composing, { type: 'imeSetMode', mode: 'direct' })

    expect(result.effect).toEqual({ kind: 'none' })
    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') {
      expect(result.state.current.ime).toEqual(directIme())
      expect(result.state.current.composing).toBeUndefined()
    }
  })

  it('imeSetMode is a no-op outside EDIT mode', () => {
    const state = loadedRecent()
    const result = reduce(state, { type: 'imeSetMode', mode: 'kana' })

    expect(result.state).toBe(state)
    expect(result.effect).toEqual({ kind: 'none' })
  })

  it('kana IME supports arrow selection, enter commit, and cancel without editing draft', () => {
    const typed = reduce(reduce(reduce(openEdit(), { type: 'imeToggle' }).state, { type: 'imeKey', key: 'k' }).state, {
      type: 'imeKey',
      key: 'a',
    }).state
    const lookup = reduce(typed, { type: 'imeKey', key: 'Space' }).state
    const candidates = reduce(lookup, { type: 'imeCandidates', text: 'か', candidates: ['蚊', '課'] }).state
    const selected = reduce(candidates, { type: 'imeKey', key: 'ArrowDown' }).state
    const committedResult = reduce(selected, { type: 'imeKey', key: 'Enter' })
    expect(committedResult.effect).toEqual({ kind: 'imeLearn', reading: 'か', candidate: '課' })
    const committed = committedResult.state

    expect(committed.current.mode).toBe('edit')
    if (committed.current.mode === 'edit') expect(committed.current.draft).toBe('課raw')

    const active = reduce(candidates, { type: 'doubleClick' }).state
    expect(active.current.mode).toBe('edit')
    if (active.current.mode === 'edit') {
      expect(active.current.draft).toBe('raw')
      expect(active.current.ime.candidates).toBeNull()
      expect(active.current.composing).toBeUndefined()
    }
  })

  it('keeps the remaining reading composing after confirming a shortened conversion range', () => {
    const partial = kanaCandidateState({
      draft: '',
      cursor: { offset: 0, line: 1, col: 1 },
      ime: {
        mode: 'kana',
        convStyle: 'classic',
        reading: 'きょうは',
        pending: '',
        raw: 'kyouha',
        candidates: ['今日'],
        selected: 0,
        splitLength: 3,
        lookupFailed: false,
        suggesting: false,
      },
      composing: 'きょうは',
    })
    const committedResult = reduce(partial, { type: 'imeKey', key: 'Enter' })
    expect(committedResult.effect).toEqual({
      kind: 'batch',
      effects: [
        { kind: 'imeLookup', text: 'は', immediate: true },
        { kind: 'imeLearn', reading: 'きょう', candidate: '今日' },
      ],
    })
    const committed = committedResult.state
    expect(committed.current.mode).toBe('edit')
    if (committed.current.mode === 'edit') {
      expect(committed.current.draft).toBe('今日')
      // 残り読み「は」が UI から消えず composing として見え続ける(不満: 残り候補が消える)
      expect(committed.current.composing).toBe('は')
      expect(committed.current.ime.reading).toBe('は')
    }
  })

  it('kana IME Space moves candidate selection forward and wraps to the first candidate', () => {
    const candidates = reduce(kanaCandidateState(), { type: 'imeKey', key: 'Space' }).state
    expect(candidates.current.mode).toBe('edit')
    if (candidates.current.mode === 'edit') expect(candidates.current.ime.selected).toBe(1)

    const atEnd = kanaCandidateState()
    if (atEnd.current.mode === 'edit') atEnd.current.ime.selected = 2
    const wrapped = reduce(atEnd, { type: 'imeKey', key: 'Space' }).state
    expect(wrapped.current.mode).toBe('edit')
    if (wrapped.current.mode === 'edit') expect(wrapped.current.ime.selected).toBe(0)
  })

  it('kana IME candidate scrolls change selection without moving the editor cursor or viewport', () => {
    const state = kanaCandidateState({ cursor: { offset: 1, line: 1, col: 2 }, scrollLine: 3 })
    const down = reduce(state, { type: 'scrollDown' }).state

    expect(down.current.mode).toBe('edit')
    if (down.current.mode === 'edit') {
      expect(down.current.ime.selected).toBe(1)
      expect(down.current.cursor).toEqual({ offset: 1, line: 1, col: 2 })
      expect(down.current.scrollLine).toBe(3)
    }

    const up = reduce(down, { type: 'scrollUp' }).state
    expect(up.current.mode).toBe('edit')
    if (up.current.mode === 'edit') {
      expect(up.current.ime.selected).toBe(0)
      expect(up.current.cursor).toEqual({ offset: 1, line: 1, col: 2 })
      expect(up.current.scrollLine).toBe(3)
    }
  })

  it('returns scrollDown to normal cursor movement after confirming an IME candidate', () => {
    const committed = reduce(kanaCandidateState({ draft: 'raw\nnext' }), { type: 'click' }).state
    const moved = reduce(committed, { type: 'scrollDown' }).state

    expect(moved.current.mode).toBe('edit')
    if (moved.current.mode === 'edit') {
      expect(moved.current.ime.candidates).toBeNull()
      expect(moved.current.cursor.line).toBe(2)
      expect(moved.current.cursor.col).toBe(2)
      // sticky viewport: 全体が1画面に収まるので先頭行のまま
      expect(moved.current.scrollLine).toBe(0)
    }
  })

  it('marks IME lookup failures without opening candidates and clears the flag on success', () => {
    const lookup = reduce(reduce(reduce(openEdit(), { type: 'imeToggle' }).state, { type: 'imeKey', key: 'k' }).state, {
      type: 'imeKey',
      key: 'a',
    }).state
    const failed = reduce(lookup, { type: 'imeCandidates', text: 'か', candidates: [], error: true }).state

    expect(failed.current.mode).toBe('edit')
    if (failed.current.mode === 'edit') {
      expect(failed.current.ime.candidates).toBeNull()
      expect(failed.current.ime.lookupFailed).toBe(true)
      expect(failed.current.composing).toBe('か')
    }

    const recovered = reduce(failed, { type: 'imeCandidates', text: 'か', candidates: ['蚊'] }).state
    expect(recovered.current.mode).toBe('edit')
    if (recovered.current.mode === 'edit') {
      expect(recovered.current.ime.candidates).toEqual(['蚊', 'カ', 'ka']) // カタカナ/英字候補を付与
      expect(recovered.current.ime.lookupFailed).toBe(false)
    }
  })

  it('kana IME empty Escape falls through to discardEdit so the editor can close', () => {
    const kana = reduce(openEdit(), { type: 'imeToggle' }).state
    const result = reduce(kana, { type: 'imeKey', key: 'Escape' })

    expect(result.effect).toEqual({ kind: 'openRecent' })
    expect(result.state.current.mode).toBe('list')
  })

  it('kana IME empty Space commits a full-width Japanese space', () => {
    const kana = reduce(openEdit(), { type: 'imeToggle' }).state
    const result = reduce(kana, { type: 'imeKey', key: 'Space' })

    expect(result.effect).toEqual({ kind: 'none' })
    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') expect(result.state.current.draft).toBe('　raw')
  })

  it('saveDone clears dirty and saveFailed keeps draft with status', () => {
    const saving = reduce(openEdit(), { type: 'requestSave' }).state
    const saved = reduce(saving, { type: 'saveDone', mtime: 123 })

    expect(saved.state.current.mode).toBe('edit')
    if (saved.state.current.mode === 'edit') {
      expect(saved.state.current.dirty).toBe(false)
      expect(saved.state.current.baseMtime).toBe(123)
      expect(saved.state.current.status).toBe('editing')
    }

    const dirty = reduce(openEdit(), {
      type: 'editInput',
      draft: 'changed',
      cursor: { offset: 7, line: 1, col: 8 },
    }).state
    const failed = reduce(dirty, { type: 'saveFailed', status: 'conflict', message: 'reload' })

    expect(failed.state.current.mode).toBe('edit')
    if (failed.state.current.mode === 'edit') {
      expect(failed.state.current.status).toBe('conflict')
      expect(failed.state.current.draft).toBe('changed')
      expect(failed.state.current.message).toBe('reload')
    }
  })

  it('keeps the viewport fixed while the cursor moves up within the visible window (sticky scroll)', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`)
    const draft = lines.join('\n')
    const offsetOf = (line: number) => lines.slice(0, line - 1).join('\n').length + (line === 1 ? 0 : 1)
    let state: AppState = kanaCandidateState({
      draft,
      cursor: { offset: offsetOf(10), line: 10, col: 1 },
      scrollLine: 5,
      ime: directIme(),
      composing: undefined,
    })

    // 論理行10→6(表示行9→5)は窓[5..11]の内側 → scrollLine は 5 のまま
    for (const expectedLine of [9, 8, 7, 6]) {
      state = reduce(state, { type: 'scrollUp' }).state
      expect(state.current.mode).toBe('edit')
      if (state.current.mode === 'edit') {
        expect(state.current.cursor.line).toBe(expectedLine)
        expect(state.current.scrollLine).toBe(5)
      }
    }

    // 論理行5(表示行4)は窓の上に出る → scrollLine が 4 に追従
    state = reduce(state, { type: 'scrollUp' }).state
    expect(state.current.mode).toBe('edit')
    if (state.current.mode === 'edit') {
      expect(state.current.cursor.line).toBe(5)
      expect(state.current.scrollLine).toBe(4)
    }
  })

  it('stores the selection anchor from editInput', () => {
    const result = reduce(openEdit(), {
      type: 'editInput',
      draft: 'raw',
      cursor: { offset: 3, line: 1, col: 4 },
      selAnchor: 1,
    })

    expect(result.state.current.mode).toBe('edit')
    if (result.state.current.mode === 'edit') expect(result.state.current.selAnchor).toBe(1)
  })

  it('replaces the selected range when committing IME text', () => {
    const state = kanaCandidateState({
      draft: 'raw',
      cursor: { offset: 3, line: 1, col: 4 },
      selAnchor: 1,
    })
    const committed = reduce(state, { type: 'click' }).state

    expect(committed.current.mode).toBe('edit')
    if (committed.current.mode === 'edit') {
      expect(committed.current.draft).toBe('r蚊')
      expect(committed.current.cursor.offset).toBe(2)
      expect(committed.current.selAnchor).toBeUndefined()
    }
  })

})

function openEdit(): AppState {
  const requested = reduce(loadedRecent(), { type: 'click', index: 2 })
  return reduce(requested.state, {
    type: 'loadedFile',
    path: 'a.md',
    rawContent: 'raw',
    mtime: 99,
  }).state
}

function kanaCandidateState(overrides: Partial<EditState> = {}): AppState {
  return {
    current: {
      mode: 'edit',
      title: 'note.md',
      path: 'note.md',
      baseMtime: 1,
      draft: 'raw',
      dirty: false,
      cursor: { offset: 0, line: 1, col: 1 },
      status: 'editing',
      scrollLine: null,
      ime: {
        mode: 'kana',
        convStyle: 'classic',
        reading: 'か',
        pending: '',
        raw: 'ka',
        candidates: ['蚊', '課', '可'],
        selected: 0,
        splitLength: 0,
        lookupFailed: false,
        suggesting: false,
      },
      composing: 'か',
      ...overrides,
    },
    stack: [],
    exitRequested: false,
  }
}

function directIme() {
  return {
    mode: 'direct' as const,
    convStyle: 'classic' as const,
    reading: '',
    pending: '',
    raw: '',
    candidates: null,
    selected: 0,
    splitLength: 0,
    lookupFailed: false,
    suggesting: false,
  }
}
