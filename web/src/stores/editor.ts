import { createMemo } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { api, type MappingDetail } from "../api/client";
import { groupFiles, autoSelect } from "../lib/games";

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

function deriveInitialSelected(sourceFiles: string[], destFiles: string[]): Record<string, true> {
  const sourceSet = new Set(sourceFiles);
  const out: Record<string, true> = {};
  for (const f of destFiles) {
    if (sourceSet.has(f)) out[f] = true;
  }
  return out;
}

async function load(id: string) {
  setState({ loading: true, error: null });
  try {
    const detail = await api.getMapping(id);
    setState({
      detail,
      selected: deriveInitialSelected(detail.sourceFiles, detail.destFiles),
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
 * file, deselect them all; otherwise auto-pick the best variant.
 */
function togglePrefix(files: string[]) {
  setState(
    produce((s) => {
      const anySelected = files.some((f) => s.selected[f]);
      if (anySelected) {
        for (const f of files) delete s.selected[f];
      } else {
        const pick = autoSelect(files);
        if (pick) s.selected[pick] = true;
      }
      s.dirty = true;
    }),
  );
}

/** Destination-side prefix click: deselect every file in the group. */
function clearFiles(files: string[]) {
  setState(
    produce((s) => {
      for (const f of files) delete s.selected[f];
      s.dirty = true;
    }),
  );
}

function setManualGroup(filename: string, target: string) {
  setState(
    produce((s) => {
      if (target === "") delete s.manualGroups[filename];
      else s.manualGroups[filename] = target;
      s.dirty = true;
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

const destProjectionGroups = createMemo(() => groupFiles(intendedFiles(), state.manualGroups));

/**
 * Files currently in the destination that the user has deselected and
 * that have a source counterpart — these will be deleted on the next
 * sync (rendered red as "TO BE REMOVED ON SYNC").
 */
const filesToRemove = createMemo<string[]>(() => {
  const detail = state.detail;
  if (!detail) return [];
  const sourceSet = new Set(detail.sourceFiles);
  return detail.destFiles.filter((f) => !state.selected[f] && sourceSet.has(f));
});

/**
 * Files in the destination with no source counterpart — preserved on
 * sync and shown in orange. The mapping cannot produce or remove them.
 */
const extraFiles = createMemo<string[]>(() => {
  const detail = state.detail;
  if (!detail) return [];
  const sourceSet = new Set(detail.sourceFiles);
  return detail.destFiles.filter((f) => !sourceSet.has(f));
});

const pendingDiff = createMemo<{ toCopy: number; toDelete: number }>(() => {
  const detail = state.detail;
  if (!detail) return { toCopy: 0, toDelete: 0 };
  const have = new Set(detail.destFiles);
  const sourceSet = new Set(detail.sourceFiles);
  let toCopy = 0;
  let toDelete = 0;
  for (const f of Object.keys(state.selected)) {
    if (!have.has(f)) toCopy++;
  }
  for (const f of detail.destFiles) {
    if (state.selected[f]) continue;
    if (!sourceSet.has(f)) continue;
    toDelete++;
  }
  return { toCopy, toDelete };
});

export const editor = {
  state,
  load,
  toggleFile,
  togglePrefix,
  clearFiles,
  isFileSelected,
  setManualGroup,
  sync,
  intendedFiles,
  filesToRemove,
  extraFiles,
  destProjectionGroups,
  pendingDiff,
};
