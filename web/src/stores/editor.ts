import { createMemo } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { api, type MappingDetail, type SourceView } from '../api/client'
import { groupFiles, autoSelectVariant, isAllowedExt, variantKey } from '../lib/games'
import type { GameGroup } from '../lib/games'

/**
 * Editor state for a single mapping. The initial set of selected files
 * is derived from the destination directory (intersected with the union
 * of every source) at load time. User edits stage in memory until sync()
 * reaches out to the server, which reconciles the disk against the
 * intended set.
 *
 * A mapping can pull from several source directories at once. The source
 * column shows one source at a time (`activeSource`); the destination is
 * reconciled against the union of all of them. Filenames are expected to
 * be unique across the union — because `selected` is keyed by filename, a
 * given name can be selected from exactly one source at a time, which is
 * how "you can't have the same file from two sources" is enforced.
 */
export interface EditorState {
  detail: MappingDetail | null
  /**
   * Filename → the source directory it is selected from. Keyed by source
   * filename; the value records which source feeds it (so multi-source
   * copies know their origin and the dest panel can label each file).
   */
  selected: Record<string, string>
  /** Source directory currently shown in the source column. */
  activeSource: string
  manualGroups: Record<string, string>
  dirty: boolean
  loading: boolean
  error: string | null
}

const [state, setState] = createStore<EditorState>({
  detail: null,
  selected: {},
  activeSource: '',
  manualGroups: {},
  dirty: false,
  loading: false,
  error: null,
})

/**
 * Order the sources so the primary (if set and present) comes first,
 * followed by the rest in configured order. This is the precedence used
 * to decide which source "owns" a filename when more than one source
 * happens to contain it.
 */
function orderSources(sources: SourceView[], primary: string): SourceView[] {
  if (!primary) return sources
  const idx = sources.findIndex((s) => s.path === primary)
  if (idx <= 0) return sources
  return [sources[idx], ...sources.slice(0, idx), ...sources.slice(idx + 1)]
}

/**
 * Map each filename to the source directory that owns it: the first
 * source (in primary-first order) whose file list contains the name.
 * Filenames are expected to be unique across sources; the ordering only
 * matters as a deterministic tiebreak if that expectation is violated.
 */
function buildOwner(ordered: SourceView[]): Map<string, string> {
  const owner = new Map<string, string>()
  for (const s of ordered) {
    for (const f of s.files) {
      if (!owner.has(f)) owner.set(f, s.path)
    }
  }
  return owner
}

/**
 * Derive the initial selected set from disk: a source file is selected
 * iff dest contains either (a) the same filename, or (b) a file with the
 * same `variantKey` (prefix + non-track tags) and an extension in
 * `allowedExts`. Each selected file is tagged with the source directory
 * that owns it. Variant-key matching (rather than plain stem) lets a
 * single source zip claim every track file extracted from it.
 */
function deriveInitialSelected(
  ordered: SourceView[],
  owner: Map<string, string>,
  destFiles: string[],
  allowedExts: string[],
): Record<string, string> {
  const sourceSet = new Set<string>()
  const sourceByVariant = new Map<string, string[]>()
  for (const s of ordered) {
    for (const f of s.files) {
      if (sourceSet.has(f)) continue
      sourceSet.add(f)
      const key = variantKey(f)
      const arr = sourceByVariant.get(key) ?? []
      arr.push(f)
      sourceByVariant.set(key, arr)
    }
  }
  const out: Record<string, string> = {}
  for (const d of destFiles) {
    if (sourceSet.has(d)) {
      out[d] = owner.get(d) ?? ''
      continue
    }
    if (!isAllowedExt(d, allowedExts)) continue
    const candidates = sourceByVariant.get(variantKey(d))
    if (candidates && candidates.length > 0) {
      const src = candidates[0]
      out[src] = owner.get(src) ?? ''
    }
  }
  return out
}

async function load(id: string) {
  setState({ loading: true, error: null })
  try {
    const detail = await api.getMapping(id)
    const ordered = orderSources(detail.sources, detail.mapping.primarySource)
    const owner = buildOwner(ordered)
    const active = detail.mapping.primarySource || detail.sources[0]?.path || ''
    setState({
      detail,
      activeSource: active,
      selected: deriveInitialSelected(
        ordered,
        owner,
        detail.destFiles,
        detail.mapping.allowedExtensions,
      ),
      manualGroups: { ...(detail.mapping.manualGroups ?? {}) },
      dirty: false,
      loading: false,
    })
  } catch (e) {
    setState({ loading: false, error: (e as Error).message })
  }
}

/** Switch which source directory the source column displays. */
function setActiveSource(path: string) {
  setState('activeSource', path)
}

function isFileSelected(filename: string): boolean {
  return state.selected[filename] !== undefined
}

/**
 * Resolve the source directory to attribute a newly-selected file to: the
 * active source if that source contains the file (so a file present in
 * several sources is credited to the one the user is looking at),
 * otherwise the file's owning source. Falls back to the active source.
 */
function dirFor(filename: string): string {
  const dd = detailDerived()
  if (dd.activeFileSet.has(filename)) return state.activeSource
  return dd.sourceDir.get(filename) ?? state.activeSource
}

function toggleFile(filename: string) {
  const dir = dirFor(filename)
  setState(
    produce((s) => {
      if (s.selected[filename] !== undefined) delete s.selected[filename]
      else s.selected[filename] = dir
      s.dirty = true
    }),
  )
}

/**
 * Source-side prefix click: if the displayed group has any selected
 * file, deselect them all; otherwise auto-pick the best variant using
 * the mapping's effective preferences and select every file that
 * belongs to that variant (so multi-track sets toggle as a unit). The
 * picked files all belong to the active source.
 */
function togglePrefix(files: string[]) {
  const active = state.activeSource
  setState(
    produce((s) => {
      const anySelected = files.some((f) => s.selected[f] !== undefined)
      if (anySelected) {
        for (const f of files) delete s.selected[f]
        s.dirty = true
      } else {
        const prefs = s.detail?.effectivePreferences
        const pick = autoSelectVariant(files, prefs)
        let changed = false
        for (const f of pick) {
          if (s.selected[f] === undefined) {
            s.selected[f] = active
            changed = true
          }
        }
        if (changed) s.dirty = true
      }
    }),
  )
}

/**
 * Toggle every file in a bundle atomically. If any file is currently
 * selected, deselect the whole bundle; otherwise select every file in
 * the bundle, attributing each to its resolved source directory.
 *
 * Callers on the destination side resolve dest filenames to source
 * filenames (via destNameToSource) before passing in, then dedupe.
 */
function toggleBundle(files: string[]) {
  if (files.length === 0) return
  const unique = Array.from(new Set(files))
  const dirs = unique.map((f) => dirFor(f))
  setState(
    produce((s) => {
      const anySelected = unique.some((f) => s.selected[f] !== undefined)
      if (anySelected) {
        for (const f of unique) delete s.selected[f]
      } else {
        unique.forEach((f, i) => (s.selected[f] = dirs[i]))
      }
      s.dirty = true
    }),
  )
}

/** Destination-side prefix click: deselect every file in the group. */
function clearFiles(files: string[]) {
  setState(
    produce((s) => {
      let changed = false
      for (const f of files) {
        if (s.selected[f] !== undefined) {
          delete s.selected[f]
          changed = true
        }
      }
      if (changed) s.dirty = true
    }),
  )
}

/**
 * Source-side Toggle All On: force auto-select the best variant for
 * each group (of the active source). Multi-file variants (cue + tracks)
 * are selected together, attributed to the active source.
 */
function selectAllGroups(allGroupFiles: string[][]) {
  const active = state.activeSource
  setState(
    produce((s) => {
      const prefs = s.detail?.effectivePreferences
      let changed = false
      for (const files of allGroupFiles) {
        const pick = autoSelectVariant(files, prefs)
        const pickSet = new Set(pick)
        const currentlySelected = files.filter((f) => s.selected[f] !== undefined)
        const alreadyCorrect =
          currentlySelected.length === pickSet.size &&
          currentlySelected.every((f) => pickSet.has(f))
        if (alreadyCorrect) continue
        for (const f of files) delete s.selected[f]
        for (const f of pick) s.selected[f] = active
        changed = true
      }
      if (changed) s.dirty = true
    }),
  )
}

/** Toggle All Off for either side: deselect every file in every group. */
function deselectAllGroups(allGroupFiles: string[][]) {
  setState(
    produce((s) => {
      let changed = false
      for (const files of allGroupFiles) {
        for (const f of files) {
          if (s.selected[f] !== undefined) {
            delete s.selected[f]
            changed = true
          }
        }
      }
      if (changed) s.dirty = true
    }),
  )
}

/** Destination-side Toggle All On: re-add previously removed files to selected. */
function restoreFiles(filenames: string[]) {
  const dirs = filenames.map((f) => dirFor(f))
  setState(
    produce((s) => {
      let changed = false
      filenames.forEach((f, i) => {
        if (s.selected[f] === undefined) {
          s.selected[f] = dirs[i]
          changed = true
        }
      })
      if (changed) s.dirty = true
    }),
  )
}

function setManualGroup(filename: string, target: string) {
  setState(
    produce((s) => {
      if (target === '') {
        if (s.manualGroups[filename] !== undefined) {
          delete s.manualGroups[filename]
          s.dirty = true
        }
      } else if (s.manualGroups[filename] !== target) {
        s.manualGroups[filename] = target
        s.dirty = true
      }
    }),
  )
}

async function sync() {
  if (!state.detail) return null
  const id = state.detail.mapping.id
  const intended = Object.entries(state.selected).map(([name, dir]) => ({ name, dir }))
  const result = await api.sync(id, {
    intended,
    manualGroups: state.manualGroups,
  })
  await load(id)
  return result
}

const intendedFiles = createMemo<string[]>(() => Object.keys(state.selected))

/**
 * The source view currently shown in the source column (primary/first
 * by default, swapped by setActiveSource).
 */
const activeSourceView = createMemo<SourceView | null>(() => {
  const detail = state.detail
  if (!detail) return null
  return detail.sources.find((s) => s.path === state.activeSource) ?? detail.sources[0] ?? null
})

const sourceGroups = createMemo<GameGroup[]>(() => activeSourceView()?.groups ?? [])

/**
 * Stable derived state from `state.detail`. Everything here depends only
 * on the loaded mapping (its sources + dest), not on user selections, so
 * it isn't recomputed on every selection toggle. The source maps are
 * built over the UNION of all sources (in primary-first order), since
 * sync reconciles against that union.
 *
 * Maps:
 *   - sourceDir: filename → owning source directory.
 *   - sourceToAltDest: source filename → alt-ext dest filenames sharing
 *     its variant key (1:N for multi-file games).
 *   - destToSource: dest filename → its source counterpart (identity for
 *     exact matches; first union source with the same variant key for
 *     alt-ext matches). Orange files are absent.
 *   - activeFileSet: filenames in the currently active source (used to
 *     attribute a newly-selected file to the right directory).
 */
const detailDerived = createMemo(() => {
  const detail = state.detail
  if (!detail) {
    return {
      allowedExts: [] as readonly string[],
      sourceDir: new Map<string, string>(),
      sourceSet: new Set<string>(),
      sourceVariants: new Set<string>(),
      destSet: new Set<string>(),
      haveAltVariants: new Set<string>(),
      sourceToAltDest: new Map<string, string[]>(),
      destToSource: new Map<string, string>(),
      activeFileSet: new Set<string>(),
    }
  }
  const allowedExts = detail.mapping.allowedExtensions
  const ordered = orderSources(detail.sources, detail.mapping.primarySource)
  const sourceDir = buildOwner(ordered)

  // Union of every source's files, in primary-first order, deduped.
  const sourceFiles: string[] = []
  const sourceSet = new Set<string>()
  for (const s of ordered) {
    for (const f of s.files) {
      if (sourceSet.has(f)) continue
      sourceSet.add(f)
      sourceFiles.push(f)
    }
  }
  const sourceVariants = new Set(sourceFiles.map(variantKey))
  const destSet = new Set(detail.destFiles)

  const sourceByVariant = new Map<string, string[]>()
  for (const f of sourceFiles) {
    const key = variantKey(f)
    const arr = sourceByVariant.get(key) ?? []
    arr.push(f)
    sourceByVariant.set(key, arr)
  }

  const haveAltVariants = new Set<string>()
  const destByAltVariant = new Map<string, string[]>()
  for (const d of detail.destFiles) {
    if (!isAllowedExt(d, allowedExts)) continue
    const key = variantKey(d)
    haveAltVariants.add(key)
    const arr = destByAltVariant.get(key) ?? []
    arr.push(d)
    destByAltVariant.set(key, arr)
  }

  const sourceToAltDest = new Map<string, string[]>()
  for (const src of sourceFiles) {
    if (destSet.has(src)) continue
    const alts = destByAltVariant.get(variantKey(src))
    if (alts && alts.length > 0) sourceToAltDest.set(src, alts.slice().sort())
  }

  const destToSource = new Map<string, string>()
  for (const d of detail.destFiles) {
    if (sourceSet.has(d)) {
      destToSource.set(d, d)
      continue
    }
    if (!isAllowedExt(d, allowedExts)) continue
    const candidates = sourceByVariant.get(variantKey(d))
    if (candidates && candidates.length > 0) destToSource.set(d, candidates[0])
  }

  const activeFileSet = new Set(
    (detail.sources.find((s) => s.path === state.activeSource) ?? detail.sources[0])?.files ?? [],
  )

  return {
    allowedExts,
    sourceDir,
    sourceSet,
    sourceVariants,
    destSet,
    haveAltVariants,
    sourceToAltDest,
    destToSource,
    activeFileSet,
  }
})

/**
 * For a filename displayed in the destination column, return the source
 * filename it represents — the key under which `state.selected` tracks
 * intent. Identity for exact-name matches; resolves alt-ext displayed
 * names back to their source counterpart. Orange files fall through to
 * the displayed name.
 */
function destNameToSource(destName: string): string {
  return detailDerived().destToSource.get(destName) ?? destName
}

/**
 * For a filename displayed in the destination column, return the source
 * directory that feeds it, or undefined if it has none (orange). Used to
 * render the per-file "from <source>" subtext. Prefers the directory the
 * file was actually selected from; falls back to its owning source.
 */
function sourceDirFor(destName: string): string | undefined {
  const src = destNameToSource(destName)
  const chosen = state.selected[src]
  if (chosen !== undefined && chosen !== '') return chosen
  return detailDerived().sourceDir.get(src)
}

/**
 * Group view of what the destination will contain after sync. For each
 * intended source file, project to its effective dest filename(s): all
 * existing alt-ext matches on disk if any, otherwise the source name.
 */
const destProjectionGroups = createMemo<GameGroup[]>(() => {
  const { sourceToAltDest } = detailDerived()
  const projected: string[] = []
  for (const src of intendedFiles()) {
    const alts = sourceToAltDest.get(src)
    if (alts && alts.length > 0) projected.push(...alts)
    else projected.push(src)
  }
  return groupFiles(projected, state.manualGroups)
})

/**
 * Files currently in the destination that the user has deselected and
 * that have a source counterpart — these will be deleted on the next
 * sync (rendered red). "managed" = matches a union source file by exact
 * name or by VariantKey with an allowed extension.
 */
const filesToRemove = createMemo<string[]>(() => {
  const detail = state.detail
  if (!detail) return []
  const { allowedExts, sourceSet, sourceVariants } = detailDerived()
  const intendedVariants = new Set(Object.keys(state.selected).map(variantKey))
  return detail.destFiles.filter((f) => {
    if (state.selected[f] !== undefined) return false
    if (isAllowedExt(f, allowedExts) && intendedVariants.has(variantKey(f))) return false
    if (sourceSet.has(f)) return true
    if (isAllowedExt(f, allowedExts) && sourceVariants.has(variantKey(f))) return true
    return false
  })
})

/**
 * Files in the destination with no source counterpart — preserved on
 * sync and shown in orange.
 */
const extraFiles = createMemo<string[]>(() => {
  const detail = state.detail
  if (!detail) return []
  const { allowedExts, sourceSet, sourceVariants } = detailDerived()
  return detail.destFiles.filter((f) => {
    if (sourceSet.has(f)) return false
    if (isAllowedExt(f, allowedExts) && sourceVariants.has(variantKey(f))) return false
    return true
  })
})

const pendingDiff = createMemo<{ toCopy: number; toDelete: number }>(() => {
  const { destSet, haveAltVariants } = detailDerived()
  let toCopy = 0
  for (const f of Object.keys(state.selected)) {
    if (destSet.has(f)) continue
    if (haveAltVariants.has(variantKey(f))) continue
    toCopy++
  }
  return { toCopy, toDelete: filesToRemove().length }
})

export const editor = {
  state,
  load,
  setActiveSource,
  sourceGroups,
  toggleFile,
  toggleBundle,
  togglePrefix,
  clearFiles,
  selectAllGroups,
  deselectAllGroups,
  restoreFiles,
  isFileSelected,
  setManualGroup,
  sync,
  intendedFiles,
  filesToRemove,
  extraFiles,
  destProjectionGroups,
  pendingDiff,
  destNameToSource,
  sourceDirFor,
}
