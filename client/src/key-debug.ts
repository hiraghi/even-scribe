interface KeyLogEntry {
  key: string
  code: string
  keyCode: number
  which: number
  isComposing: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  repeat: boolean
  mode: string
  target: string
}

const KEY_LOG_LIMIT = 30

export function installKeyDebug(getMode: () => string): { setEnabled(on: boolean): void } {
  const panel = document.createElement('div')
  panel.id = 'key-debug'
  panel.hidden = new URLSearchParams(location.search).get('keydebug') !== '1'
  Object.assign(panel.style, {
    position: 'fixed',
    right: '8px',
    bottom: '8px',
    zIndex: '2147483647',
    maxWidth: 'calc(100vw - 16px)',
    maxHeight: '40vh',
    overflow: 'auto',
    padding: '8px',
    color: '#fff',
    background: 'rgba(0, 0, 0, 0.8)',
    fontFamily: 'monospace',
    fontSize: '12px',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
    pointerEvents: 'none',
  })
  document.body.append(panel)

  const keyLog: KeyLogEntry[] = []
  ;(window as typeof window & { __keyLog: KeyLogEntry[] }).__keyLog = keyLog

  const render = () => {
    panel.textContent = keyLog
      .slice()
      .reverse()
      .map(entry =>
        `key=${entry.key} code=${entry.code} keyCode=${entry.keyCode} which=${entry.which} composing=${entry.isComposing} ctrl=${entry.ctrlKey} shift=${entry.shiftKey} alt=${entry.altKey} meta=${entry.metaKey} repeat=${entry.repeat} mode=${entry.mode} target=${entry.target}`,
      )
      .join('\n')
  }

  window.addEventListener(
    'keydown',
    event => {
      const target = event.target instanceof Element ? event.target.tagName : 'unknown'
      const active = document.activeElement === event.target
      keyLog.push({
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        which: event.which,
        isComposing: event.isComposing,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        mode: getMode(),
        target: `${target} active=${active}`,
      })
      if (keyLog.length > KEY_LOG_LIMIT) keyLog.shift()
      if (!panel.hidden) render()
    },
    { capture: true },
  )

  return {
    setEnabled(on: boolean) {
      panel.hidden = !on
      if (on) render()
    },
  }
}
