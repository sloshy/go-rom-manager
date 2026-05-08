import { createMemo } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { api, type MappingDetail } from '../api/client'
import { groupFiles, autoSelectVariant, isAllowedExt, variantKey } from '../lib/games'
import type { GameGroup } from '../lib/games'

/**
 * Editor state for a single mapping. The initial set of selected files
 * is derived from the destination directory (intersected with the
 * source) at load time. User edits stage in memory until sync() reaches
 * out to the server, which reconciles the disk against the intended set.
 */
export interface EditorState {
  detail: MappingDetail | null
  /** Filename → true presence-set. Order is not significant. */
  selected: Record<string, true>
  manualGroups: Record<string, string>
  dirty: boolean
  loading: boolean
  error: string | null
}

const [state, setState] = createStore<EditorState>({
  detail: null,
  selected: {},
  manualGroups: {},
  dirty: false,
  loading: false,
  error: null,
})

/**
 * Derive the initial selected set from disk: a source file is selected
 * iff dest contains either (a) the same filename, or (b) a file with
 * the same `variantKey` (prefix + non-track tags) and an extension in
 * `allowedExts`. Variant-key matching (rather than plain stem) lets a
 * single source zip claim every track file extracted from it — e.g.
 * source `Game.zip` matches dest files `Game.cue` AND `Game (Track 1).bin`.
 * When multiple source files share a variant key, only the first
 * (alphabetically; sourceFiles is already sorted) is marked, so the
 * projection matches what's on disk.
 */
function deriveInitialSelected(
  sourceFiles: string[],
  destFiles: string[],
  allowedExts: string[],
): Record<string, true> {
  const sourceSet = new Set(sourceFiles)
  const sourceByVariant = new Map<string, string[]>()
  for (const f of sourceFiles) {
    const key = variantKey(f)
    const arr = sourceByVariant.get(key) ?? []
    arr.push(f)
    sourceByVariant.set(key, arr)
  }
  const out: Record<string, true> = {}
  for (const d of destFiles) {
    if (sourceSet.has(d)) {
      out[d] = true
      continue
    }
    if (!isAllowedExt(d, allowedExts)) continue
    const candidates = sourceByVariant.get(variantKey(d))
    if (candidates && candidates.length > 0) {
      out[candidates[0]] = true
    }
  }
  return out
}

async function load(id: string) {
  setState({ loading: true, error: null })
  try {
    const detail = await api.getMapping(id)
    setState({
      detail,
      selected: deriveInitialSelected(
        detail.sourceFiles,
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

function isFileSelected(filename: string): boolean {
  return state.selected[filename] === true
}

function toggleFile(filename: string) {
  setState(
    produce((s) => {
      if (s.selected[filename]) delete s.selected[filename]
      else s.selected[filename] = true
      s.dirty = true
    }),
  )
}

/**
 * Source-side prefix click: if the displayed group has any selected
 * file, deselect them all; otherwise auto-pick the best variant using
 * the mapping's effective preferences and select every file that
 * belongs to that variant (so multi-track sets toggle as a unit).
 */
function togglePrefix(files: string[]) {
  setState(
    produce((s) => {
      const anySelected = files.some((f) => s.selected[f])
      if (anySelected) {
        for (const f of files) delete s.selected[f]
        s.dirty = true
      } else {
        const prefs = s.detail?.effectivePreferences
        const pick = autoSelectVariant(files, prefs)
        let changed = false
        for (const f of pick) {
          if (!s.selected[f]) {
            s.selected[f] = true
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
 * the bundle. Used by both source and destination GameRows to make a
 * multi-file game (e.g. cue + multiple .bin tracks) act as one unit.
 *
 * Callers on the destination side resolve dest filenames to source
 * filenames (via destNameToSource) before passing in, then dedupe —
 * with alt-ext mapping, several dest files can correspond to the same
 * source intent and we only need to flip that intent once.
 */
function toggleBundle(files: string[]) {
  if (files.length === 0) return
  const unique = Array.from(new Set(files))
  setState(
    produce((s) => {
      const anySelected = unique.some((f) => s.selected[f])
      if (anySelected) {
        for (const f of unique) delete s.selected[f]
      } else {
        for (const f of unique) s.selected[f] = true
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
        if (s.selected[f]) {
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
 * each group. Multi-file variants (cue + tracks) are selected together.
 */
function selectAllGroups(allGroupFiles: string[][]) {
  setState(
    produce((s) => {
      const prefs = s.detail?.effectivePreferences
      let changed = false
      for (const files of allGroupFiles) {
        const pick = autoSelectVariant(files, prefs)
        const pickSet = new Set(pick)
        const currentlySelected = files.filter((f) => s.selected[f])
        const alreadyCorrect =
          currentlySelected.length === pickSet.size &&
          currentlySelected.every((f) => pickSet.has(f))
        if (alreadyCorrect) continue
        for (const f of files) delete s.selected[f]
        for (const f of pick) s.selected[f] = true
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
          if (s.selected[f]) {
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
  setState(
    produce((s) => {
      let changed = false
      for (const f of filenames) {
        if (!s.selected[f]) {
          s.selected[f] = true
          changed = true
        }
      }
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
  const result = await api.sync(id, {
    intended: Object.keys(state.selected),
    manualGroups: state.manualGroups,
  })
  await load(id)
  return result
}

const intendedFiles = createMemo<string[]>(() => Object.keys(state.selected))

/**
 * Stable derived state from `state.detail` — anything that depends only
 * on the loaded mapping (not on user selections or manual groups) lives
 * here so it isn't recomputed on every selection toggle. Refreshes only
 * when `load()` swaps the detail.
 *
 * Maps:
 *   - sourceToAltDest: source filename → list of alt-ext dest filenames
 *     sharing its variant key. With extractArchives + multi-file zips
 *     one source may produce several dest files (e.g. cue + multiple
 *     track .bin files), hence 1:N. Variant-key matching (vs plain stem)
 *     keeps `Sample Title (Track 1).bin` linked to `Sample Title.zip`.
 *   - destToSource: dest filename → its source counterpart (identity for
 *     exact-name matches; the first source with the same variant key
 *     for alt-ext matches). Orange files are absent. Used by dest-side
 *     click handlers in MappingEditor to translate displayed names back
 *     into keys for `state.selected`.
 */
const detailDerived = createMemo(() => {
  const detail = state.detail
  if (!detail) {
    return {
      allowedExts: [] as readonly string[],
      sourceSet: new Set<string>(),
      sourceVariants: new Set<string>(),
      destSet: new Set<string>(),
      haveAltVariants: new Set<string>(),
      sourceToAltDest: new Map<string, string[]>(),
      destToSource: new Map<string, string>(),
    }
  }
  const allowedExts = detail.mapping.allowedExtensions
  const sourceSet = new Set(detail.sourceFiles)
  const sourceVariants = new Set(detail.sourceFiles.map(variantKey))
  const destSet = new Set(detail.destFiles)

  const sourceByVariant = new Map<string, string[]>()
  for (const f of detail.sourceFiles) {
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
  for (const src of detail.sourceFiles) {
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

  return {
    allowedExts,
    sourceSet,
    sourceVariants,
    destSet,
    haveAltVariants,
    sourceToAltDest,
    destToSource,
  }
})

/**
 * For a filename displayed in the destination column, return the source
 * filename it represents — i.e. the key under which `state.selected`
 * tracks intent. Identity for exact-name matches; resolves alt-ext
 * displayed names back to their source counterpart. Orange files (no
 * source counterpart) fall through to the displayed name and are
 * handled by the caller via the disabled-row UI.
 */
function destNameToSource(destName: string): string {
  return detailDerived().destToSource.get(destName) ?? destName
}

/**
 * Group view of what the destination will contain after sync. For each
 * intended source file, project to its effective dest filename(s): all
 * existing alt-ext matches on disk if any are present (one source can
 * map to several files when extractArchives produced cue+bin etc.),
 * otherwise the source name itself (which sync will copy or extract).
 *
 * Stem-bundling for multi-file display happens inside GameColumn so it
 * applies after filtering — keeping it here would mean filters could
 * hide individual files of a bundle without the bundle reflecting that.
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
 * sync (rendered red as "TO BE REMOVED ON SYNC"). A dest file is
 * "managed" if it matches a source file by exact name or by VariantKey
 * with an extension in the mapping's allowedExtensions list.
 */
const filesToRemove = createMemo<string[]>(() => {
  const detail = state.detail
  if (!detail) return []
  const { allowedExts, sourceSet, sourceVariants } = detailDerived()
  const intendedVariants = new Set(Object.keys(state.selected).map(variantKey))
  return detail.destFiles.filter((f) => {
    if (state.selected[f]) return false
    if (isAllowedExt(f, allowedExts) && intendedVariants.has(variantKey(f))) return false
    if (sourceSet.has(f)) return true
    if (isAllowedExt(f, allowedExts) && sourceVariants.has(variantKey(f))) return true
    return false
  })
})

/**
 * Files in the destination with no source counterpart — preserved on
 * sync and shown in orange. With alt-extensions configured, a dest file
 * is still "orange" only if it matches no source file by exact name AND
 * no source file by VariantKey-with-allowed-extension.
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
}
