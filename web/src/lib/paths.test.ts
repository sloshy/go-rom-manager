import { describe, expect, it } from 'vitest'
import { sourceLabel } from './paths'

describe('sourceLabel', () => {
  it('returns the trailing path segment', () => {
    expect(sourceLabel('/roms/console-a/usa')).toBe('usa')
    expect(sourceLabel('/roms')).toBe('roms')
  })

  it('ignores trailing slashes', () => {
    expect(sourceLabel('/roms/console-a/')).toBe('console-a')
  })

  it('handles empty input', () => {
    expect(sourceLabel('')).toBe('')
  })
})
