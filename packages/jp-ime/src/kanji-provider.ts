export interface KanjiProvider {
  lookup(reading: string): Promise<string[]>
}

export function parseTransliterateCandidates(payload: unknown): string[] {
  if (!Array.isArray(payload)) return []
  const first = payload[0] as unknown
  if (!Array.isArray(first)) return []
  const candidates = first[1] as unknown
  if (!Array.isArray(candidates)) return []
  return candidates.filter((candidate): candidate is string => typeof candidate === 'string')
}

export class GoogleTransliterateProvider implements KanjiProvider {
  async lookup(reading: string): Promise<string[]> {
    const response = await fetch(
      `https://www.google.com/transliterate?langpair=ja-Hira|ja&text=${encodeURIComponent(`${reading},`)}`,
    )
    if (!response.ok) throw new Error(response.statusText || `HTTP ${response.status}`)
    return parseTransliterateCandidates(await response.json())
  }
}

export function parseInputToolsCandidates(payload: unknown): string[] {
  if (!Array.isArray(payload) || payload[0] !== 'SUCCESS') return []
  const first = (payload[1] as unknown[])?.[0]
  if (!Array.isArray(first)) return []
  const candidates = first[1]
  if (!Array.isArray(candidates)) return []
  return candidates.filter((c): c is string => typeof c === 'string')
}

export class GoogleInputToolsProvider implements KanjiProvider {
  constructor(private readonly num = 15) {}

  async lookup(reading: string): Promise<string[]> {
    const url =
      `https://inputtools.google.com/request?text=${encodeURIComponent(reading)}` +
      `&itc=ja-t-i0-und&num=${this.num}&cp=0&cs=1&ie=utf-8&oe=utf-8&app=eveng2`
    const response = await fetch(url)
    if (!response.ok) throw new Error(response.statusText || `HTTP ${response.status}`)
    return parseInputToolsCandidates(await response.json())
  }
}
