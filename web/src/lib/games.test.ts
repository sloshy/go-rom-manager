import { describe, expect, it } from 'vitest'
import {
  autoSelect,
  autoSelectVariant,
  bundleByVariant,
  fileExt,
  fileStem,
  groupFiles,
  isAllowedExt,
  parseName,
  variantKey,
} from './games'

describe('parseName', () => {
  it('splits prefix and tags', () => {
    const p = parseName('Example Game 1 (USA).zip')
    expect(p.prefix).toBe('Example Game 1')
    expect(p.tags).toEqual(['USA'])
  })

  it('returns multiple tags in order', () => {
    const p = parseName('Example Game 2 (World) (Rev 2).zip')
    expect(p.prefix).toBe('Example Game 2')
    expect(p.tags).toEqual(['World', 'Rev 2'])
  })

  it('handles untagged names', () => {
    const p = parseName('Plain Title.zip')
    expect(p.prefix).toBe('Plain Title')
    expect(p.tags).toEqual([])
  })
})

describe('groupFiles', () => {
  it('buckets files by parsed prefix', () => {
    const groups = groupFiles([
      'Example Game 1 (USA).zip',
      'Example Game 1 (Japan).zip',
      'Example Game 2 (World).zip',
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].prefix).toBe('Example Game 1')
    expect(groups[0].files).toHaveLength(2)
    expect(groups[1].prefix).toBe('Example Game 2')
  })

  it('honours manual group overrides', () => {
    const groups = groupFiles(['Example Game 1 (USA).zip', 'Some Different Title (Japan).zip'], {
      'Some Different Title (Japan).zip': 'Example Game 1',
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].files).toHaveLength(2)
  })
})

describe('autoSelect', () => {
  it('prefers USA', () => {
    expect(
      autoSelect([
        'Example Game 1 (Japan).zip',
        'Example Game 1 (USA).zip',
        'Example Game 1 (Europe).zip',
      ]),
    ).toBe('Example Game 1 (USA).zip')
  })

  it('falls back to World', () => {
    expect(autoSelect(['Example Game 2 (Japan).zip', 'Example Game 2 (World).zip'])).toBe(
      'Example Game 2 (World).zip',
    )
  })

  it('picks highest revision within priority', () => {
    expect(
      autoSelect([
        'Example Game 3 (USA).zip',
        'Example Game 3 (USA) (Rev 1).zip',
        'Example Game 3 (USA) (Rev 2).zip',
      ]),
    ).toBe('Example Game 3 (USA) (Rev 2).zip')
  })

  it('excludes Demo and Proto when alternatives exist', () => {
    expect(
      autoSelect([
        'Example Game 4 (USA) (Demo).zip',
        'Example Game 4 (USA) (Proto).zip',
        'Example Game 4 (USA).zip',
      ]),
    ).toBe('Example Game 4 (USA).zip')
  })

  it('returns empty for empty input', () => {
    expect(autoSelect([])).toBe('')
  })

  it('respects a custom preference order', () => {
    const files = [
      'Example Game 1 (USA).zip',
      'Example Game 1 (Japan).zip',
      'Example Game 1 (Europe).zip',
    ]
    expect(autoSelect(files, ['Japan', 'USA'])).toBe('Example Game 1 (Japan).zip')
    expect(autoSelect(files, ['Europe'])).toBe('Example Game 1 (Europe).zip')
  })

  it('falls through unmatched preferences in order', () => {
    const files = ['Example Game 1 (Japan).zip', 'Example Game 1 (Europe).zip']
    expect(autoSelect(files, ['USA', 'Japan', 'Europe'])).toBe('Example Game 1 (Japan).zip')
  })

  it('filters Demo/Proto regardless of preferences', () => {
    const files = ['Example Game 1 (Japan) (Demo).zip', 'Example Game 1 (Japan).zip']
    expect(autoSelect(files, ['Japan'])).toBe('Example Game 1 (Japan).zip')
  })

  it('demotes Sample by default', () => {
    const files = ['Example Game 1 (USA) (Sample).zip', 'Example Game 1 (USA).zip']
    expect(autoSelect(files)).toBe('Example Game 1 (USA).zip')
  })

  it('only picks a low-priority variant when nothing cleaner exists', () => {
    const files = ['Example Game 1 (USA) (Sample).zip']
    expect(autoSelect(files)).toBe('Example Game 1 (USA) (Sample).zip')
  })

  it('honours a custom low-priority list', () => {
    const files = ['Example Game 1 (USA) (Beta).zip', 'Example Game 1 (USA).zip']
    // "Beta" isn't demoted by default, but a custom list demotes it.
    expect(autoSelect(files, undefined, ['Beta'])).toBe('Example Game 1 (USA).zip')
  })

  it('an empty low-priority list demotes nothing', () => {
    const files = ['Example Game 1 (Japan).zip', 'Example Game 1 (USA) (Demo).zip']
    expect(autoSelect(files, ['USA'], [])).toBe('Example Game 1 (USA) (Demo).zip')
  })
})

describe('fileStem / fileExt', () => {
  it('strips the trailing extension', () => {
    expect(fileStem('Game.zip')).toBe('Game')
    expect(fileStem('Sample Game (USA).rvz')).toBe('Sample Game (USA)')
  })

  it("returns the bare name when there's no extension", () => {
    expect(fileStem('README')).toBe('README')
    expect(fileExt('README')).toBe('')
  })

  it('treats leading-dot files as having no extension (stem = full name)', () => {
    expect(fileStem('.gitignore')).toBe('.gitignore')
    expect(fileExt('.gitignore')).toBe('')
  })

  it('lowercases the extension', () => {
    expect(fileExt('Game.RVZ')).toBe('.rvz')
  })

  it('treats compound extensions as a single token', () => {
    expect(fileExt('Example (USA).tar.gz')).toBe('.tar.gz')
    expect(fileExt('Example (USA).tar.bz2')).toBe('.tar.bz2')
    expect(fileExt('Example (USA).tar.xz')).toBe('.tar.xz')
    expect(fileExt('Example (USA).tar.zst')).toBe('.tar.zst')
    expect(fileStem('Example (USA).tar.gz')).toBe('Example (USA)')
  })

  it('stem + ext round-trips for both simple and compound extensions', () => {
    for (const f of ['Game.zip', 'Sample (USA).rvz', 'Archive (World).tar.gz']) {
      expect(fileStem(f) + fileExt(f)).toBe(f)
    }
  })

  it('compound extension match is case-insensitive', () => {
    expect(fileExt('Example.TAR.GZ')).toBe('.tar.gz')
    expect(fileStem('Example.TAR.GZ')).toBe('Example')
  })
})

describe('variantKey', () => {
  it('keeps non-track tags in the key', () => {
    expect(variantKey('Game (USA).zip')).toBe('Game (USA)')
    expect(variantKey('Game (USA) (Rev 2).zip')).toBe('Game (USA) (Rev 2)')
  })

  it('strips Track and Side tags', () => {
    expect(variantKey('Game (USA) (Track 1).bin')).toBe('Game (USA)')
    expect(variantKey('Game (USA) (Track 12).bin')).toBe('Game (USA)')
    expect(variantKey('Game (Side A).bin')).toBe('Game')
  })

  it('does not strip multi-word title tags that happen to start with Side or Track', () => {
    // "Side Quest" / "Track Star" are real game-name fragments — only
    // bare "(Side <id>)" and "(Track <id>)" markers should be dropped.
    expect(variantKey('Side Quest (USA).zip')).toBe('Side Quest (USA)')
    expect(variantKey('Game (Side Quest).zip')).toBe('Game (Side Quest)')
    expect(variantKey('Game (Track Star Edition).zip')).toBe('Game (Track Star Edition)')
  })

  it('keeps Disc tags so different discs stay distinct variants', () => {
    expect(variantKey('Game (USA) (Disc 1).cue')).toBe('Game (USA) (Disc 1)')
    expect(variantKey('Game (USA) (Disc 1) (Track 1).bin')).toBe('Game (USA) (Disc 1)')
  })

  it('returns the prefix when no tags remain', () => {
    expect(variantKey('Game.zip')).toBe('Game')
    expect(variantKey('Game (Track 1).bin')).toBe('Game')
  })
})

describe('bundleByVariant', () => {
  it('groups a multi-track set under one bundle keyed by variant', () => {
    const bundles = bundleByVariant([
      'Sample Title (USA).cue',
      'Sample Title (USA) (Track 1).bin',
      'Sample Title (USA) (Track 2).bin',
    ])
    expect(bundles).toHaveLength(1)
    expect(bundles[0].label).toBe('Sample Title (USA)')
    expect(bundles[0].files).toEqual([
      'Sample Title (USA) (Track 1).bin',
      'Sample Title (USA) (Track 2).bin',
      'Sample Title (USA).cue',
    ])
    expect(bundles[0].extensions).toEqual(['.bin', '.bin', '.cue'])
  })

  it('keeps different regional variants in separate bundles', () => {
    const bundles = bundleByVariant([
      'Sample Title (USA) (Track 1).bin',
      'Sample Title (USA).cue',
      'Sample Title (Japan) (Track 1).bin',
      'Sample Title (Japan).cue',
    ])
    expect(bundles).toHaveLength(2)
    expect(bundles.map((b) => b.label)).toEqual(['Sample Title (Japan)', 'Sample Title (USA)'])
    for (const b of bundles) expect(b.files).toHaveLength(2)
  })

  it('keeps different discs in separate bundles', () => {
    const bundles = bundleByVariant([
      'Game (USA) (Disc 1).cue',
      'Game (USA) (Disc 1) (Track 1).bin',
      'Game (USA) (Disc 2).cue',
      'Game (USA) (Disc 2) (Track 1).bin',
    ])
    expect(bundles).toHaveLength(2)
    expect(bundles.map((b) => b.label)).toEqual(['Game (USA) (Disc 1)', 'Game (USA) (Disc 2)'])
  })

  it('handles single-file bundles', () => {
    const bundles = bundleByVariant(['Game (USA).zip'])
    expect(bundles).toHaveLength(1)
    expect(bundles[0].files).toEqual(['Game (USA).zip'])
    expect(bundles[0].extensions).toEqual(['.zip'])
  })

  it('returns empty for empty input', () => {
    expect(bundleByVariant([])).toEqual([])
  })
})

describe('autoSelectVariant', () => {
  it('returns every file in the chosen variant', () => {
    const files = [
      'Sample Title (USA).cue',
      'Sample Title (USA) (Track 1).bin',
      'Sample Title (USA) (Track 2).bin',
      'Sample Title (Japan).cue',
      'Sample Title (Japan) (Track 1).bin',
    ]
    const picked = autoSelectVariant(files)
    expect(picked.slice().sort()).toEqual([
      'Sample Title (USA) (Track 1).bin',
      'Sample Title (USA) (Track 2).bin',
      'Sample Title (USA).cue',
    ])
  })

  it('respects custom preferences', () => {
    const files = [
      'Sample Title (USA).cue',
      'Sample Title (USA) (Track 1).bin',
      'Sample Title (Japan).cue',
      'Sample Title (Japan) (Track 1).bin',
    ]
    const picked = autoSelectVariant(files, ['Japan'])
    expect(picked.slice().sort()).toEqual([
      'Sample Title (Japan) (Track 1).bin',
      'Sample Title (Japan).cue',
    ])
  })

  it('returns the single file when no track tags are present', () => {
    expect(autoSelectVariant(['Game (USA).zip', 'Game (Japan).zip'])).toEqual(['Game (USA).zip'])
  })

  it('demotes a low-priority variant across the whole bundle', () => {
    const files = [
      'Game (USA) (Sample).cue',
      'Game (USA) (Sample) (Track 1).bin',
      'Game (USA).cue',
      'Game (USA) (Track 1).bin',
    ]
    expect(autoSelectVariant(files).slice().sort()).toEqual([
      'Game (USA) (Track 1).bin',
      'Game (USA).cue',
    ])
  })

  it('returns [] for empty input', () => {
    expect(autoSelectVariant([])).toEqual([])
  })
})

describe('isAllowedExt', () => {
  it('matches case-insensitively against a normalized allow list', () => {
    expect(isAllowedExt('Game.RVZ', ['.rvz'])).toBe(true)
    expect(isAllowedExt('Game.zip', ['.rvz', '.cso'])).toBe(false)
  })

  it('returns false for empty allow list', () => {
    expect(isAllowedExt('Game.rvz', [])).toBe(false)
  })
})
