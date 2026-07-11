import { describe, expect, it } from 'vitest'
import { parseTransliterateCandidates } from '../src'

describe('parseTransliterateCandidates', () => {
  it('extracts string candidates from the Google transliterate payload', () => {
    expect(parseTransliterateCandidates([['かんじ', ['感じ', '漢字', 123]]])).toEqual(['感じ', '漢字'])
  })

  it('returns an empty list for malformed payloads', () => {
    expect(parseTransliterateCandidates(null)).toEqual([])
    expect(parseTransliterateCandidates([['かんじ', '漢字']])).toEqual([])
  })
})
