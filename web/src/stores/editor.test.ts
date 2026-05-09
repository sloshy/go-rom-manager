import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editor } from './editor'
import type { MappingDetail } from '../api/client'

let lastSyncBody: { intended: string[]; manualGroups: Record<string, string> } | null = null

type LoadFixture = {
  destFiles: string[]
  sourceFiles?: string[]
  manualGroups?: Record<string, string>
  allowedExtensions?: string[]
}

const DEFAULT_SOURCES = [
  'Example Game 1 (USA).zip',
  'Example Game 1 (Japan).zip',
  'Example Game 2 (USA).zip',
]

let nextLoad: LoadFixture = { destFiles: ['Example Game 1 (USA).zip'] }

beforeEach(() => {
  lastSyncBody = null
  nextLoad = { destFiles: ['Example Game 1 (USA).zip'] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : (url as URL).toString()
      if (u.endsWith('/sync') && init?.method === 'POST') {
        lastSyncBody = JSON.parse(init.body as string)
        return new Response(JSON.stringify({ copied: [], deleted: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (u.includes('/api/mappings/')) {
        const sources = nextLoad.sourceFiles ?? DEFAULT_SOURCES
        // Annotated as MappingDetail so the compiler enforces shape
        // completeness — every required field on the real type must be
        // present, including any added later.
        const detail: MappingDetail = {
          mapping: {
            id: 'x',
            name: 'test',
            sourcePath: '/s',
            destPath: '/d',
            manualGroups: nextLoad.manualGroups ?? {},
            allowedExtensions: nextLoad.allowedExtensions ?? [],
            extractArchives: false,
          },
          sourceFiles: sources,
          destFiles: nextLoad.destFiles,
          sourceGroups: [
            {
              prefix: 'Example Game 1',
              files: ['Example Game 1 (USA).zip', 'Example Game 1 (Japan).zip'],
            },
            { prefix: 'Example Game 2', files: ['Example Game 2 (USA).zip'] },
          ],
          effectivePreferences: ['USA', 'World'],
        }
        return new Response(JSON.stringify(detail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch,
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('editor', () => {
  it('derives initial selected set from source ∩ dest', async () => {
    nextLoad = { destFiles: ['Example Game 1 (USA).zip', 'leftover.txt'] }
    await editor.load('x')
    // "leftover.txt" has no source counterpart → not selected, surfaces as orange.
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(true)
    expect(editor.isFileSelected('leftover.txt')).toBe(false)
    expect(editor.extraFiles()).toEqual(['leftover.txt'])
  })

  it('toggleFile flips selection state for that filename', async () => {
    await editor.load('x')
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(true)

    editor.toggleFile('Example Game 1 (USA).zip')
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(false)

    editor.toggleFile('Example Game 1 (USA).zip')
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(true)
  })

  it('filesToRemove lists deselected dest files that have a source counterpart', async () => {
    await editor.load('x')
    editor.toggleFile('Example Game 1 (USA).zip')
    expect(editor.filesToRemove()).toEqual(['Example Game 1 (USA).zip'])
    expect(editor.extraFiles()).toEqual([])
  })

  it('clearFiles removes every passed filename from the selected set', async () => {
    nextLoad = { destFiles: ['Example Game 1 (USA).zip', 'Example Game 1 (Japan).zip'] }
    await editor.load('x')
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(true)
    expect(editor.isFileSelected('Example Game 1 (Japan).zip')).toBe(true)

    editor.clearFiles(['Example Game 1 (USA).zip', 'Example Game 1 (Japan).zip'])
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(false)
    expect(editor.isFileSelected('Example Game 1 (Japan).zip')).toBe(false)
  })

  it('togglePrefix clears the group when any file is selected, otherwise auto-picks', async () => {
    nextLoad = { destFiles: [] }
    await editor.load('x')
    // Nothing selected — togglePrefix should auto-pick the best variant.
    editor.togglePrefix(['Example Game 1 (USA).zip', 'Example Game 1 (Japan).zip'])
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(true)
    expect(editor.isFileSelected('Example Game 1 (Japan).zip')).toBe(false)

    // Now any file selected — togglePrefix should clear them.
    editor.togglePrefix(['Example Game 1 (USA).zip', 'Example Game 1 (Japan).zip'])
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(false)
  })

  it('sync sends the flat intended list and manualGroups', async () => {
    await editor.load('x')
    editor.toggleFile('Example Game 1 (USA).zip') // deselect
    editor.toggleFile('Example Game 2 (USA).zip') // newly select

    await editor.sync()

    expect(lastSyncBody).not.toBeNull()
    expect(lastSyncBody!.intended.sort()).toEqual(['Example Game 2 (USA).zip'])
  })

  it('treats an alt-ext dest file as satisfying its source counterpart', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.rvz'],
      allowedExtensions: ['.rvz'],
    }
    await editor.load('x')
    // The .rvz on disk represents the .zip in source — treat the source
    // file as already-selected; the dest file is NOT orange.
    expect(editor.isFileSelected('Game.zip')).toBe(true)
    expect(editor.extraFiles()).toEqual([])
    // No copies, no deletes pending.
    expect(editor.pendingDiff()).toEqual({ toCopy: 0, toDelete: 0 })
  })

  it('treats an alt-ext dest file with unknown ext as orange', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.cso'],
      allowedExtensions: ['.rvz'],
    }
    await editor.load('x')
    // .cso isn't in the allow list → no relationship to source → orange.
    expect(editor.isFileSelected('Game.zip')).toBe(false)
    expect(editor.extraFiles()).toEqual(['Game.cso'])
  })

  it('queues an alt-ext dest file for deletion when its source is deselected', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.rvz'],
      allowedExtensions: ['.rvz'],
    }
    await editor.load('x')
    editor.toggleFile('Game.zip')
    // The user removed the game from intent → Game.rvz is managed (alt-ext
    // match) and queued for deletion on next sync.
    expect(editor.filesToRemove()).toEqual(['Game.rvz'])
    expect(editor.pendingDiff()).toEqual({ toCopy: 0, toDelete: 1 })
  })

  it('does not queue a copy when an alt-ext satisfier already exists', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.rvz'],
      allowedExtensions: ['.rvz'],
    }
    await editor.load('x')
    // Initial state already has Game.zip selected (via alt-ext). pendingDiff
    // must show no copy because Game.rvz already represents the game in dest.
    expect(editor.pendingDiff().toCopy).toBe(0)
  })

  it('destProjectionGroups shows the alt-ext filename when one is on disk', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.rvz'],
      allowedExtensions: ['.rvz'],
    }
    await editor.load('x')
    const groups = editor.destProjectionGroups()
    // The dest panel should reflect what disk WILL contain post-sync —
    // Game.rvz survives, Game.zip is never copied. Project source intent
    // to its alt-ext counterpart.
    expect(groups).toHaveLength(1)
    expect(groups[0].files).toEqual(['Game.rvz'])
  })

  it('destProjectionGroups falls back to source name when no alt-ext satisfier exists', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: [],
      allowedExtensions: ['.rvz'],
    }
    await editor.load('x')
    // Nothing in dest — Game.zip will be copied as-is on sync.
    editor.toggleFile('Game.zip')
    const groups = editor.destProjectionGroups()
    expect(groups[0].files).toEqual(['Game.zip'])
  })

  it('destNameToSource maps alt-ext dest filenames back to source intent', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.rvz'],
      allowedExtensions: ['.rvz'],
    }
    await editor.load('x')
    expect(editor.destNameToSource('Game.rvz')).toBe('Game.zip')
    // Identity for exact-name matches and unknown names.
    expect(editor.destNameToSource('Game.zip')).toBe('Game.zip')
    expect(editor.destNameToSource('Unrelated.txt')).toBe('Unrelated.txt')
  })

  it('expands one source to multiple dest files when several share its variant key', async () => {
    // Mirror the post-extract state for a multi-file zip: one source
    // (Game.zip) corresponds to two dest files (Game.bin + Game.cue),
    // both alt-ext matched by stem. The dest projection should show
    // BOTH files under the same source intent, not just one.
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.bin', 'Game.cue'],
      allowedExtensions: ['.bin', '.cue'],
    }
    await editor.load('x')
    expect(editor.isFileSelected('Game.zip')).toBe(true)
    const groups = editor.destProjectionGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].files.slice().sort()).toEqual(['Game.bin', 'Game.cue'])
    // No pending ops — both files already on disk satisfy the intent.
    expect(editor.pendingDiff()).toEqual({ toCopy: 0, toDelete: 0 })
  })

  it('variant-key alt-ext links extracted track files back to the source zip', async () => {
    // Post-extract state: source Sample Title.zip → dest .cue + N×bin
    // tracks. The bins have a different *stem* ("Sample Title (Track 1)")
    // but the same *variant key* ("Sample Title") as the source.
    // Variant-key matching keeps them all under the same source intent
    // and out of the orange "no source counterpart" pool.
    nextLoad = {
      sourceFiles: ['Sample Title.zip'],
      destFiles: ['Sample Title.cue', 'Sample Title (Track 1).bin', 'Sample Title (Track 2).bin'],
      allowedExtensions: ['.bin', '.cue'],
    }
    await editor.load('x')
    expect(editor.isFileSelected('Sample Title.zip')).toBe(true)
    // No orange — every track file traces back to the zip via variant key.
    expect(editor.extraFiles()).toEqual([])
    // All three dest files project under the single source intent.
    const groups = editor.destProjectionGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].files.slice().sort()).toEqual([
      'Sample Title (Track 1).bin',
      'Sample Title (Track 2).bin',
      'Sample Title.cue',
    ])
    // No pending ops, and every dest file resolves back to the source.
    expect(editor.pendingDiff()).toEqual({ toCopy: 0, toDelete: 0 })
    expect(editor.destNameToSource('Sample Title.cue')).toBe('Sample Title.zip')
    expect(editor.destNameToSource('Sample Title (Track 1).bin')).toBe('Sample Title.zip')
    expect(editor.destNameToSource('Sample Title (Track 2).bin')).toBe('Sample Title.zip')
  })

  it('different discs stay distinct under variant-key matching', async () => {
    // (Disc N) is intentionally excluded from variant-part stripping —
    // disc 2 must NOT inherit disc 1's source intent.
    nextLoad = {
      sourceFiles: ['Game (Disc 1).zip', 'Game (Disc 2).zip'],
      destFiles: [
        'Game (Disc 1).cue',
        'Game (Disc 1) (Track 1).bin',
        'Game (Disc 2).cue',
        'Game (Disc 2) (Track 1).bin',
      ],
      allowedExtensions: ['.bin', '.cue'],
    }
    await editor.load('x')
    expect(editor.isFileSelected('Game (Disc 1).zip')).toBe(true)
    expect(editor.isFileSelected('Game (Disc 2).zip')).toBe(true)
    expect(editor.destNameToSource('Game (Disc 1) (Track 1).bin')).toBe('Game (Disc 1).zip')
    expect(editor.destNameToSource('Game (Disc 2) (Track 1).bin')).toBe('Game (Disc 2).zip')
    expect(editor.extraFiles()).toEqual([])
  })

  it('queues all alt-ext dest files for deletion when source is deselected', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.bin', 'Game.cue'],
      allowedExtensions: ['.bin', '.cue'],
    }
    await editor.load('x')
    editor.toggleFile('Game.zip')
    // Deselecting the single source must mark BOTH alt-ext files for
    // removal — multi-file games delete atomically.
    expect(editor.filesToRemove().slice().sort()).toEqual(['Game.bin', 'Game.cue'])
    expect(editor.pendingDiff()).toEqual({ toCopy: 0, toDelete: 2 })
  })

  it('destNameToSource resolves every dest file in a multi-file bundle to one source', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.bin', 'Game.cue'],
      allowedExtensions: ['.bin', '.cue'],
    }
    await editor.load('x')
    // Both alt-ext files trace back to the single source — clicking either
    // toggles the same intent in state.selected.
    expect(editor.destNameToSource('Game.bin')).toBe('Game.zip')
    expect(editor.destNameToSource('Game.cue')).toBe('Game.zip')
  })

  it('togglePrefix on a multi-track source group selects every track of the best variant', async () => {
    nextLoad = {
      sourceFiles: [
        'Sample Title (USA).cue',
        'Sample Title (USA) (Track 1).bin',
        'Sample Title (USA) (Track 2).bin',
        'Sample Title (Japan).cue',
        'Sample Title (Japan) (Track 1).bin',
      ],
      destFiles: [],
    }
    await editor.load('x')

    editor.togglePrefix([
      'Sample Title (USA).cue',
      'Sample Title (USA) (Track 1).bin',
      'Sample Title (USA) (Track 2).bin',
      'Sample Title (Japan).cue',
      'Sample Title (Japan) (Track 1).bin',
    ])

    // USA preference wins; ALL three USA files become selected together.
    expect(editor.isFileSelected('Sample Title (USA).cue')).toBe(true)
    expect(editor.isFileSelected('Sample Title (USA) (Track 1).bin')).toBe(true)
    expect(editor.isFileSelected('Sample Title (USA) (Track 2).bin')).toBe(true)
    expect(editor.isFileSelected('Sample Title (Japan).cue')).toBe(false)
    expect(editor.isFileSelected('Sample Title (Japan) (Track 1).bin')).toBe(false)
  })

  it('toggleBundle deselects every file when any is selected, and selects all when none are', async () => {
    nextLoad = {
      sourceFiles: ['Game.cue', 'Game (Track 1).bin', 'Game (Track 2).bin'],
      destFiles: ['Game.cue', 'Game (Track 1).bin', 'Game (Track 2).bin'],
    }
    await editor.load('x')

    // All three pre-selected from disk. toggleBundle clears them all.
    editor.toggleBundle(['Game.cue', 'Game (Track 1).bin', 'Game (Track 2).bin'])
    expect(editor.isFileSelected('Game.cue')).toBe(false)
    expect(editor.isFileSelected('Game (Track 1).bin')).toBe(false)
    expect(editor.isFileSelected('Game (Track 2).bin')).toBe(false)

    // Nothing selected — toggleBundle now selects every file in the bundle.
    editor.toggleBundle(['Game.cue', 'Game (Track 1).bin', 'Game (Track 2).bin'])
    expect(editor.isFileSelected('Game.cue')).toBe(true)
    expect(editor.isFileSelected('Game (Track 1).bin')).toBe(true)
    expect(editor.isFileSelected('Game (Track 2).bin')).toBe(true)
  })

  it('toggleBundle dedupes when multiple dest files map to one source intent', async () => {
    nextLoad = {
      sourceFiles: ['Game.zip'],
      destFiles: ['Game.bin', 'Game.cue'],
      allowedExtensions: ['.bin', '.cue'],
    }
    await editor.load('x')
    expect(editor.isFileSelected('Game.zip')).toBe(true)

    // Both dest files resolve to the same source ('Game.zip'). toggleBundle
    // should flip that one source intent, not run twice.
    const resolved = ['Game.bin', 'Game.cue'].map(editor.destNameToSource)
    editor.toggleBundle(resolved)
    expect(editor.isFileSelected('Game.zip')).toBe(false)
  })

  it('selectAllGroups picks the best variant per group atomically', async () => {
    nextLoad = {
      sourceFiles: [
        'Game (USA).cue',
        'Game (USA) (Track 1).bin',
        'Game (USA) (Track 2).bin',
        'Game (Japan).cue',
        'Game (Japan) (Track 1).bin',
      ],
      destFiles: [],
    }
    await editor.load('x')

    editor.selectAllGroups([
      [
        'Game (USA).cue',
        'Game (USA) (Track 1).bin',
        'Game (USA) (Track 2).bin',
        'Game (Japan).cue',
        'Game (Japan) (Track 1).bin',
      ],
    ])
    // USA variant wins → all three USA files selected, no Japan files.
    expect(editor.isFileSelected('Game (USA).cue')).toBe(true)
    expect(editor.isFileSelected('Game (USA) (Track 1).bin')).toBe(true)
    expect(editor.isFileSelected('Game (USA) (Track 2).bin')).toBe(true)
    expect(editor.isFileSelected('Game (Japan).cue')).toBe(false)
  })

  it('rehydrates from disk after sync — no persisted selection state', async () => {
    await editor.load('x')
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(true)

    // User deselects in memory.
    editor.toggleFile('Example Game 1 (USA).zip')
    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(false)

    // The reload (after sync) reflects new dest contents — pretend the
    // server actually deleted the file. The editor must rebuild "selected"
    // from disk, not from any stale persisted JSON.
    nextLoad = { destFiles: [] }
    await editor.sync()

    expect(editor.isFileSelected('Example Game 1 (USA).zip')).toBe(false)
    expect(editor.filesToRemove()).toEqual([])
    expect(editor.extraFiles()).toEqual([])
  })
})
