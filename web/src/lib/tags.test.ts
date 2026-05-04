import { describe, expect, it } from 'vitest'
import {
  activeTagFilterCount,
  collectTagTokens,
  commitFilterDraft,
  extractTagTokens,
  fileMatchesTags,
  groupMatchesTags,
  hasActiveTagFilters,
  matchesChips,
  nextTagFilterState,
  parseFilterChips,
  tokenizeFilterInput,
} from './tags'

describe('tokenizeFilterInput', () => {
  it('returns no chips and empty remainder for blank input', () => {
    expect(tokenizeFilterInput('')).toEqual({ chips: [], remainder: '' })
    expect(tokenizeFilterInput('   ')).toEqual({ chips: [], remainder: '' })
  })

  it('commits a bare token only when followed by whitespace', () => {
    expect(tokenizeFilterInput('Gun')).toEqual({ chips: [], remainder: 'Gun' })
    expect(tokenizeFilterInput('Gun ')).toEqual({
      chips: [{ text: 'Gun', negative: false }],
      remainder: '',
    })
  })

  it('commits a quoted token as soon as the closing quote is seen', () => {
    expect(tokenizeFilterInput('"Sample Title"')).toEqual({
      chips: [{ text: 'Sample Title', negative: false }],
      remainder: '',
    })
  })

  it('leaves an open-quoted token in the remainder', () => {
    expect(tokenizeFilterInput('"Samp')).toEqual({
      chips: [],
      remainder: '"Samp',
    })
  })

  it('treats a leading -word as negative', () => {
    expect(tokenizeFilterInput('-Bad ')).toEqual({
      chips: [{ text: 'Bad', negative: true }],
      remainder: '',
    })
  })

  it('supports -"..." negative quoted spans', () => {
    expect(tokenizeFilterInput('-"Sample Title" ')).toEqual({
      chips: [{ text: 'Sample Title', negative: true }],
      remainder: '',
    })
  })

  it('commits multiple tokens separated by spaces', () => {
    expect(tokenizeFilterInput('Gun -Ball ')).toEqual({
      chips: [
        { text: 'Gun', negative: false },
        { text: 'Ball', negative: true },
      ],
      remainder: '',
    })
  })

  it('returns the unfinished tail as the remainder when typing in progress', () => {
    expect(tokenizeFilterInput('Gun -Ba')).toEqual({
      chips: [{ text: 'Gun', negative: false }],
      remainder: '-Ba',
    })
  })

  it('drops lone-dash tokens (`-`, `--`, ...)', () => {
    expect(tokenizeFilterInput('- foo ')).toEqual({
      chips: [{ text: 'foo', negative: false }],
      remainder: '',
    })
    expect(tokenizeFilterInput('-- foo ')).toEqual({
      chips: [{ text: 'foo', negative: false }],
      remainder: '',
    })
  })

  it('treats `--foo` as a literal positive token (no double-negate)', () => {
    expect(tokenizeFilterInput('--foo ')).toEqual({
      chips: [{ text: '--foo', negative: false }],
      remainder: '',
    })
  })

  it('drops empty quoted spans, with or without negative prefix', () => {
    expect(tokenizeFilterInput('"" ')).toEqual({ chips: [], remainder: '' })
    expect(tokenizeFilterInput('-"" ')).toEqual({ chips: [], remainder: '' })
  })

  it('preserves an unclosed `-"` partial in the remainder', () => {
    expect(tokenizeFilterInput('-"')).toEqual({ chips: [], remainder: '-"' })
  })
})

describe('commitFilterDraft', () => {
  it('returns null for blank input', () => {
    expect(commitFilterDraft('')).toBeNull()
    expect(commitFilterDraft('   ')).toBeNull()
  })

  it('commits a bare positive draft', () => {
    expect(commitFilterDraft('Gun')).toEqual({ text: 'Gun', negative: false })
  })

  it('commits a bare negative draft', () => {
    expect(commitFilterDraft('-Bad')).toEqual({ text: 'Bad', negative: true })
  })

  it('strips an unclosed leading quote', () => {
    expect(commitFilterDraft('"Samp')).toEqual({ text: 'Samp', negative: false })
  })

  it('strips a fully quoted draft including a negative prefix', () => {
    expect(commitFilterDraft('-"Sample Title"')).toEqual({
      text: 'Sample Title',
      negative: true,
    })
  })

  it('returns null for all-dash drafts (`-`, `--`, ...)', () => {
    expect(commitFilterDraft('-')).toBeNull()
    expect(commitFilterDraft('--')).toBeNull()
    expect(commitFilterDraft('---')).toBeNull()
  })

  it('returns null for empty quoted drafts (`""`, `-""`)', () => {
    expect(commitFilterDraft('""')).toBeNull()
    expect(commitFilterDraft('-""')).toBeNull()
  })

  it('treats `--foo` as a literal positive (no double-negate)', () => {
    expect(commitFilterDraft('--foo')).toEqual({
      text: '--foo',
      negative: false,
    })
  })
})

describe('parseFilterChips', () => {
  it('collapses tokens and any trailing draft into chips', () => {
    expect(parseFilterChips('Gun -Ball "Sample Title"')).toEqual([
      { text: 'Gun', negative: false },
      { text: 'Ball', negative: true },
      { text: 'Sample Title', negative: false },
    ])
  })

  it('treats an unfinished trailing token as a chip', () => {
    expect(parseFilterChips('Gun')).toEqual([{ text: 'Gun', negative: false }])
  })
})

describe('matchesChips', () => {
  it('passes everything when no chips are set', () => {
    expect(matchesChips('anything', [])).toBe(true)
  })

  it('requires every positive chip as a substring', () => {
    const chips = parseFilterChips('Gun ')
    expect(matchesChips('Sample Gun Title', chips)).toBe(true)
    expect(matchesChips('Sample Title', chips)).toBe(false)
  })

  it('rejects a string containing any negative chip', () => {
    const chips = parseFilterChips('-Demo ')
    expect(matchesChips('Sample (Demo)', chips)).toBe(false)
    expect(matchesChips('Sample (USA)', chips)).toBe(true)
  })

  it('combines positive and negative chips', () => {
    const chips = parseFilterChips('Sample -Demo ')
    expect(matchesChips('Sample (USA)', chips)).toBe(true)
    expect(matchesChips('Sample (Demo)', chips)).toBe(false)
    expect(matchesChips('Other (USA)', chips)).toBe(false)
  })

  it('matches case-insensitively', () => {
    const chips = parseFilterChips('-USA ')
    expect(matchesChips('sample (usa)', chips)).toBe(false)
  })
})

describe('extractTagTokens', () => {
  it('splits parenthesised groups by comma', () => {
    expect(extractTagTokens('Example (USA, Europe).zip')).toEqual(['USA', 'Europe'])
  })

  it('includes square-bracket groups', () => {
    expect(extractTagTokens('Example (USA) [b1].zip')).toEqual(['USA', 'b1'])
  })

  it('dedupes within a single filename, preserving first form', () => {
    expect(extractTagTokens('Example (USA) (USA, usa).zip')).toEqual(['USA'])
  })

  it('returns empty for unparenthesised names', () => {
    expect(extractTagTokens('Plain Title.zip')).toEqual([])
  })

  it('keeps Rev N as a single token (does not split on spaces)', () => {
    expect(extractTagTokens('Example (USA) (Rev 2).zip')).toEqual(['USA', 'Rev 2'])
  })

  it('treats a bare number alone in parentheses as a token', () => {
    expect(extractTagTokens('Example (1).zip')).toEqual(['1'])
  })

  it('treats a comma-separated number as its own token', () => {
    expect(extractTagTokens('Example (Rev 1, Beta).zip')).toEqual(['Rev 1', 'Beta'])
  })

  it('handles comma-separated tokens with no surrounding spaces', () => {
    expect(extractTagTokens('Example (En,Fr,De).zip')).toEqual(['En', 'Fr', 'De'])
  })
})

describe('collectTagTokens', () => {
  it('merges and sorts case-insensitively across filenames', () => {
    expect(
      collectTagTokens(['Example (USA).zip', 'Example (Europe).zip', 'Example (usa, Japan).zip']),
    ).toEqual(['Europe', 'Japan', 'USA'])
  })
})

describe('fileMatchesTags', () => {
  it('requires every positive tag to be present', () => {
    expect(fileMatchesTags('Example (USA).zip', { USA: 'positive' })).toBe(true)
    expect(fileMatchesTags('Example (Japan).zip', { USA: 'positive' })).toBe(false)
  })

  it('excludes files containing any negative tag', () => {
    expect(fileMatchesTags('Example (Demo).zip', { Demo: 'negative' })).toBe(false)
    expect(fileMatchesTags('Example (USA).zip', { Demo: 'negative' })).toBe(true)
  })

  it('ignores tags marked off', () => {
    expect(fileMatchesTags('Example (USA).zip', { USA: 'off' })).toBe(true)
  })

  it("matches a multi-word tag token like 'Rev 2' as one unit", () => {
    expect(fileMatchesTags('Example (USA) (Rev 2).zip', { 'Rev 2': 'positive' })).toBe(true)
    expect(fileMatchesTags('Example (USA) (Rev 1).zip', { 'Rev 2': 'positive' })).toBe(false)
  })
})

describe('groupMatchesTags', () => {
  it('passes when at least one file has the positive tag', () => {
    expect(
      groupMatchesTags(['Example (Japan).zip', 'Example (USA).zip'], { USA: 'positive' }),
    ).toBe(true)
  })

  it('fails when no file has a positive tag', () => {
    expect(groupMatchesTags(['Example (Japan).zip'], { USA: 'positive' })).toBe(false)
  })

  it('rejects the group when any file has the negative tag', () => {
    expect(
      groupMatchesTags(['Example (USA).zip', 'Example (Japan).zip'], { Japan: 'negative' }),
    ).toBe(false)
  })
})

describe('nextTagFilterState', () => {
  it('cycles off → positive → negative → off', () => {
    expect(nextTagFilterState('off')).toBe('positive')
    expect(nextTagFilterState('positive')).toBe('negative')
    expect(nextTagFilterState('negative')).toBe('off')
  })
})

describe('hasActiveTagFilters', () => {
  it('returns false when only off entries are present', () => {
    expect(hasActiveTagFilters({})).toBe(false)
    expect(hasActiveTagFilters({ USA: 'off' })).toBe(false)
  })

  it('returns true when any entry is positive or negative', () => {
    expect(hasActiveTagFilters({ USA: 'positive' })).toBe(true)
    expect(hasActiveTagFilters({ USA: 'off', Japan: 'negative' })).toBe(true)
  })
})

describe('activeTagFilterCount', () => {
  it('counts only positive and negative entries', () => {
    expect(activeTagFilterCount({})).toBe(0)
    expect(activeTagFilterCount({ USA: 'off' })).toBe(0)
    expect(activeTagFilterCount({ USA: 'positive' })).toBe(1)
    expect(activeTagFilterCount({ USA: 'positive', Japan: 'negative', Europe: 'off' })).toBe(2)
  })
})
