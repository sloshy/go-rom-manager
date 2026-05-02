import { createMemo } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { api, type MappingDetail } from "../api/client";
import { groupFiles, autoSelect, fileStem, isAllowedExt } from "../lib/games";

/**
 * Editor state for a single mapping. The initial set of selected files
 * is derived from the destination directory (intersected with the
 * source) at load time. User edits stage in memory until sync() reaches
 * out to the server, which reconciles the disk against the intended set.
 */
export interface EditorState {
  detail: MappingDetail | null;
  /** Filename → true presence-set. Order is not significant. */
  selected: Record<string, true>;
  manualGroups: Record<string, string>;
  dirty: boolean;
  loading: boolean;
  error: string | null;
}

const [state, setState] = createStore<EditorState>({
  detail: null,
  selected: {},
  manualGroups: {},
  dirty: false,
  loading: false,
  error: null,
});

/**
 * Derive the initial selected set from disk: a source file is selected
 * iff dest contains either (a) the same filename, or (b) a file with
 * the same stem and an extension in `allowedExts`. When multiple source
 * files share a stem, only the first (alphabetically; sourceFiles is
 * already sorted) is marked, so the projection matches what's on disk.
 */
function deriveInitialSelected(
  sourceFiles: string[],
  destFiles: string[],
  allowedExts: string[],
): Record<string, true> {
  const sourceSet = new Set(sourceFiles);
  const sourceByStem = new Map<string, string[]>();
  for (const f of sourceFiles) {
    const stem = fileStem(f);
    const arr = sourceByStem.get(stem) ?? [];
    arr.push(f);
    sourceByStem.set(stem, arr);
  }
  const out: Record<string, true> = {};
  for (const d of destFiles) {
    if (sourceSet.has(d)) {
      out[d] = true;
      continue;
    }
    if (!isAllowedExt(d, allowedExts)) continue;
    const candidates = sourceByStem.get(fileStem(d));
    if (candidates && candidates.length > 0) {
      out[candidates[0]] = true;
    }
  }
  return out;
}

async function load(id: string) {
  setState({ loading: true, error: null });
  try {
    const detail = await api.getMapping(id);
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
    });
  } catch (e) {
    setState({ loading: false, error: (e as Error).message });
  }
}

function isFileSelected(filename: string): boolean {
  return state.selected[filename] === true;
}

function toggleFile(filename: string) {
  setState(
    produce((s) => {
      if (s.selected[filename]) delete s.selected[filename];
      else s.selected[filename] = true;
      s.dirty = true;
    }),
  );
}

/**
 * Source-side prefix click: if the displayed group has any selected
 * file, deselect them all; otherwise auto-pick the best variant using
 * the mapping's effective preferences (override or inherited global).
 */
function togglePrefix(files: string[]) {
  setState(
    produce((s) => {
      const anySelected = files.some((f) => s.selected[f]);
      if (anySelected) {
        for (const f of files) delete s.selected[f];
        s.dirty = true;
      } else {
        const prefs = s.detail?.effectivePreferences;
        const pick = autoSelect(files, prefs);
        if (pick && !s.selected[pick]) {
          s.selected[pick] = true;
          s.dirty = true;
        }
      }
    }),
  );
}

/** Destination-side prefix click: deselect every file in the group. */
function clearFiles(files: string[]) {
  setState(
    produce((s) => {
      let changed = false;
      for (const f of files) {
        if (s.selected[f]) { delete s.selected[f]; changed = true; }
      }
      if (changed) s.dirty = true;
    }),
  );
}

/** Source-side Toggle All On: force auto-select the best variant for each group. */
function selectAllGroups(allGroupFiles: string[][]) {
  setState(
    produce((s) => {
      const prefs = s.detail?.effectivePreferences;
      let changed = false;
      for (const files of allGroupFiles) {
        const pick = autoSelect(files, prefs);
        const currentlySelected = files.filter((f) => s.selected[f]);
        const alreadyCorrect = pick
          ? currentlySelected.length === 1 && currentlySelected[0] === pick
          : currentlySelected.length === 0;
        if (!alreadyCorrect) {
          for (const f of files) delete s.selected[f];
          if (pick) s.selected[pick] = true;
          changed = true;
        }
      }
      if (changed) s.dirty = true;
    }),
  );
}

/** Toggle All Off for either side: deselect every file in every group. */
function deselectAllGroups(allGroupFiles: string[][]) {
  setState(
    produce((s) => {
      let changed = false;
      for (const files of allGroupFiles) {
        for (const f of files) {
          if (s.selected[f]) { delete s.selected[f]; changed = true; }
        }
      }
      if (changed) s.dirty = true;
    }),
  );
}

/** Destination-side Toggle All On: re-add previously removed files to selected. */
function restoreFiles(filenames: string[]) {
  setState(
    produce((s) => {
      let changed = false;
      for (const f of filenames) {
        if (!s.selected[f]) { s.selected[f] = true; changed = true; }
      }
      if (changed) s.dirty = true;
    }),
  );
}

function setManualGroup(filename: string, target: string) {
  setState(
    produce((s) => {
      if (target === "") {
        if (s.manualGroups[filename] !== undefined) {
          delete s.manualGroups[filename];
          s.dirty = true;
        }
      } else if (s.manualGroups[filename] !== target) {
        s.manualGroups[filename] = target;
        s.dirty = true;
      }
    }),
  );
}

async function sync() {
  if (!state.detail) return null;
  const id = state.detail.mapping.id;
  const result = await api.sync(id, {
    intended: Object.keys(state.selected),
    manualGroups: state.manualGroups,
  });
  await load(id);
  return result;
}

const intendedFiles = createMemo<string[]>(() => Object.keys(state.selected));

/**
 * Stable derived state from `state.detail` — anything that depends only
 * on the loaded mapping (not on user selections or manual groups) lives
 * here so it isn't recomputed on every selection toggle. Refreshes only
 * when `load()` swaps the detail.
 *
 * Maps:
 *   - sourceToAltDest: source filename → alt-ext dest filename when an
 *     alt-ext satisfier is present on disk. Used to project the dest view.
 *   - destToSource: dest filename → its source counterpart (identity for
 *     exact-name matches; the first source with the same stem for
 *     alt-ext matches). Orange files are absent. Used by dest-side click
 *     handlers in MappingEditor to translate displayed names back into
 *     keys for `state.selected`.
 */
const detailDerived = createMemo(() => {
  const detail = state.detail;
  if (!detail) {
    return {
      allowedExts: [] as readonly string[],
      sourceSet: new Set<string>(),
      sourceStems: new Set<string>(),
      destSet: new Set<string>(),
      haveAltStems: new Set<string>(),
      sourceToAltDest: new Map<string, string>(),
      destToSource: new Map<string, string>(),
    };
  }
  const allowedExts = detail.mapping.allowedExtensions;
  const sourceSet = new Set(detail.sourceFiles);
  const sourceStems = new Set(detail.sourceFiles.map(fileStem));
  const destSet = new Set(detail.destFiles);

  const sourceByStem = new Map<string, string[]>();
  for (const f of detail.sourceFiles) {
    const stem = fileStem(f);
    const arr = sourceByStem.get(stem) ?? [];
    arr.push(f);
    sourceByStem.set(stem, arr);
  }

  const haveAltStems = new Set<string>();
  const destByAltStem = new Map<string, string>();
  for (const d of detail.destFiles) {
    if (!isAllowedExt(d, allowedExts)) continue;
    const stem = fileStem(d);
    haveAltStems.add(stem);
    if (!destByAltStem.has(stem)) destByAltStem.set(stem, d);
  }

  const sourceToAltDest = new Map<string, string>();
  for (const src of detail.sourceFiles) {
    if (destSet.has(src)) continue;
    const alt = destByAltStem.get(fileStem(src));
    if (alt) sourceToAltDest.set(src, alt);
  }

  const destToSource = new Map<string, string>();
  for (const d of detail.destFiles) {
    if (sourceSet.has(d)) {
      destToSource.set(d, d);
      continue;
    }
    if (!isAllowedExt(d, allowedExts)) continue;
    const candidates = sourceByStem.get(fileStem(d));
    if (candidates && candidates.length > 0) destToSource.set(d, candidates[0]);
  }

  return { allowedExts, sourceSet, sourceStems, destSet, haveAltStems, sourceToAltDest, destToSource };
});

/**
 * For a filename displayed in the destination column, return the source
 * filename it represents — i.e. the key under which `state.selected`
 * tracks intent. Identity for exact-name matches; resolves alt-ext
 * displayed names back to their source counterpart. Orange files (no
 * source counterpart) fall through to the displayed name and are
 * handled by the caller via the disabled-row UI.
 */
function destNameToSource(destName: string): string {
  return detailDerived().destToSource.get(destName) ?? destName;
}

/**
 * Group view of what the destination will contain after sync. For each
 * intended source file, project to its effective dest filename: an
 * existing alt-ext match on disk if one is present, otherwise the source
 * name (which sync will copy as-is). This means the right panel shows
 * actual on-disk filenames post-sync, not just the source-side intent.
 */
const destProjectionGroups = createMemo(() => {
  const { sourceToAltDest } = detailDerived();
  const projected = intendedFiles().map((src) => sourceToAltDest.get(src) ?? src);
  return groupFiles(projected, state.manualGroups);
});

/**
 * Files currently in the destination that the user has deselected and
 * that have a source counterpart — these will be deleted on the next
 * sync (rendered red as "TO BE REMOVED ON SYNC"). A dest file is
 * "managed" if it matches a source file by exact name or by stem with
 * an extension in the mapping's allowedExtensions list.
 */
const filesToRemove = createMemo<string[]>(() => {
  const detail = state.detail;
  if (!detail) return [];
  const { allowedExts, sourceSet, sourceStems } = detailDerived();
  const intendedStems = new Set(Object.keys(state.selected).map(fileStem));
  return detail.destFiles.filter((f) => {
    if (state.selected[f]) return false;
    if (isAllowedExt(f, allowedExts) && intendedStems.has(fileStem(f))) return false;
    if (sourceSet.has(f)) return true;
    if (isAllowedExt(f, allowedExts) && sourceStems.has(fileStem(f))) return true;
    return false;
  });
});

/**
 * Files in the destination with no source counterpart — preserved on
 * sync and shown in orange. With alt-extensions configured, a dest file
 * is still "orange" only if it matches no source file by exact name AND
 * no source file by stem-with-allowed-extension.
 */
const extraFiles = createMemo<string[]>(() => {
  const detail = state.detail;
  if (!detail) return [];
  const { allowedExts, sourceSet, sourceStems } = detailDerived();
  return detail.destFiles.filter((f) => {
    if (sourceSet.has(f)) return false;
    if (isAllowedExt(f, allowedExts) && sourceStems.has(fileStem(f))) return false;
    return true;
  });
});

const pendingDiff = createMemo<{ toCopy: number; toDelete: number }>(() => {
  const { destSet, haveAltStems } = detailDerived();
  let toCopy = 0;
  for (const f of Object.keys(state.selected)) {
    if (destSet.has(f)) continue;
    if (haveAltStems.has(fileStem(f))) continue;
    toCopy++;
  }
  return { toCopy, toDelete: filesToRemove().length };
});

export const editor = {
  state,
  load,
  toggleFile,
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
};
