export function isZenkakuHankakuKey(key: string): boolean {
  return key === 'Zenkaku' || key === 'Hankaku' || key === 'ZenkakuHankaku' || key === 'KanjiMode'
}

export function toImeKey(event: KeyboardEvent): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === 'Backspace') return 'Backspace'
  if (event.key === ' ') return 'Space'
  if (event.key === 'Enter') return 'Enter'
  if (event.key === 'Escape') return 'Escape'
  if (event.key === 'ArrowUp') return 'ArrowUp'
  if (event.key === 'ArrowDown') return 'ArrowDown'
  if (event.key === 'ArrowLeft') return event.shiftKey ? 'Shift+ArrowLeft' : 'ArrowLeft'
  if (event.key === 'ArrowRight') return event.shiftKey ? 'Shift+ArrowRight' : 'ArrowRight'
  if (event.key === 'F10') return 'F10'
  if (event.shiftKey && /^[a-z]$/i.test(event.key)) return `Latin:${event.key.toUpperCase()}`
  if (/^[1-9]$/.test(event.key)) return event.key
  if (event.key.length === 1 && /^[ -~]$/.test(event.key)) return event.key
  return null
}
