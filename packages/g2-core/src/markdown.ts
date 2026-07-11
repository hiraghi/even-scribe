export function cleanMarkdown(src: string): string {
  const lines = src.split(/\r?\n/)
  if (!lines[0]?.startsWith('---')) return src

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) return src

  return lines.slice(closingIndex + 1).join('\n').trim()
}
