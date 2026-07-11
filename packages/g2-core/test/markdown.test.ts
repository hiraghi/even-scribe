import { describe, expect, it } from 'vitest'
import { cleanMarkdown } from '../src/markdown'

describe('cleanMarkdown', () => {
  it('removes leading YAML frontmatter', () => {
    const source = '---\ntitle: Test\ntags:\n  - g2\n---\n\n# Heading\nbody'
    expect(cleanMarkdown(source)).toBe('# Heading\nbody')
  })

  it('keeps content unchanged when frontmatter is absent', () => {
    const source = '# Heading\n\n---\nnot frontmatter'
    expect(cleanMarkdown(source)).toBe(source)
  })
})
