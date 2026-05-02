import { Component, For, Show, createMemo, createSignal } from "solid-js";
import { FilterChipInput } from "./FilterChipInput";
import { GameRow } from "./GameRow";
import { TagFilterMenu } from "./TagFilterMenu";
import type { GameGroup } from "../lib/games";
import {
  collectTagTokens,
  fileMatchesTags,
  groupMatchesTags,
  hasActiveTagFilters,
  matchesChips,
  type FilterChip,
  type TagFilters,
} from "../lib/tags";

export interface GameColumnProps {
  title: string;
  side: "source" | "destination";
  groups: GameGroup[];
  /** Destination files the user has just deselected (was managed, now isn't). */
  filesToRemove?: string[];
  /** Destination files with no source counterpart (locked, must persist). */
  extraFiles?: string[];
  isFileSelected: (filename: string) => boolean;
  onToggleFile?: (filename: string) => void;
  /** Source-side: toggle prefix selection on/off (auto-pick best variant). */
  onTogglePrefix?: (files: string[]) => void;
  /** Destination-side: clear all selected files in the displayed group. */
  onClearPrefix?: (files: string[]) => void;
  onContextFile?: (filename: string, evt: MouseEvent) => void;
  /**
   * Toggle All On: source = auto-select best variant per visible group;
   * destination = restore visible files-to-remove back into selected.
   * Receives the currently visible groups and removals so the handler can act
   * only on what the filter shows.
   */
  onToggleAllOn?: (groups: GameGroup[], removals: string[]) => void;
  /** Toggle All Off: deselect all files in every visible group. */
  onToggleAllOff?: (groups: GameGroup[]) => void;
}

export const GameColumn: Component<GameColumnProps> = (props) => {
  const [filterChips, setFilterChips] = createSignal<FilterChip[]>([]);
  const [tagFilters, setTagFilters] = createSignal<TagFilters>({});
  const [filterGroupedItems, setFilterGroupedItems] = createSignal(false);

  const tagsActive = createMemo(() => hasActiveTagFilters(tagFilters()));

  const tokens = createMemo(() =>
    collectTagTokens([
      ...props.groups.flatMap((g) => g.files),
      ...(props.filesToRemove ?? []),
      ...(props.extraFiles ?? []),
    ]),
  );

  /**
   * Visible groups are filtered first by prefix expression, then by tags.
   * With "Filter grouped items" off (the default), tag filters apply at
   * group granularity (any-or-none) and the group's full file list is
   * shown. With it on, individual files within each group are filtered;
   * an empty group drops out and the now-narrowed `files` list flows
   * through to GameRow + togglePrefix + Toggle-All-On so auto-select sees
   * only the surviving variants.
   */
  const visibleGroups = createMemo<GameGroup[]>(() => {
    const chips = filterChips();
    const tags = tagFilters();
    const grouped = filterGroupedItems();
    const tagsOn = tagsActive();

    const out: GameGroup[] = [];
    for (const g of props.groups) {
      if (!matchesChips(g.prefix, chips)) continue;
      if (!tagsOn) {
        out.push(g);
        continue;
      }
      if (grouped) {
        const files = g.files.filter((f) => fileMatchesTags(f, tags));
        if (files.length === 0) continue;
        out.push({ prefix: g.prefix, files });
      } else if (groupMatchesTags(g.files, tags)) {
        out.push(g);
      }
    }
    return out;
  });

  const flatFileVisible = (f: string): boolean => {
    if (!matchesChips(f, filterChips())) return false;
    if (!tagsActive()) return true;
    return fileMatchesTags(f, tagFilters());
  };

  const visibleRemovals = createMemo(() =>
    (props.filesToRemove ?? []).filter(flatFileVisible),
  );

  const visibleExtras = createMemo(() =>
    (props.extraFiles ?? []).filter(flatFileVisible),
  );

  return (
    <div class="tui-panel">
      <div class="tui-titlebar">
        <span>{props.title}</span>
        <span class="text-dim">{props.groups.length} TITLES</span>
      </div>
      <div style={{ padding: "10px 10px 54px", flex: 1, "overflow-y": "auto", "min-height": 0 }}>
        <FilterChipInput chips={filterChips()} onChange={setFilterChips}>
          <TagFilterMenu
            tokens={tokens()}
            filters={tagFilters()}
            onFilterChange={setTagFilters}
            filterGroupedItems={filterGroupedItems()}
            onToggleGroupedItems={setFilterGroupedItems}
          />
        </FilterChipInput>
        <Show when={props.onToggleAllOn || props.onToggleAllOff}>
          <div class="row" style={{ "margin-bottom": "8px", gap: "6px" }}>
            <Show when={props.onToggleAllOn}>
              <button
                class="tui-button"
                onClick={() => props.onToggleAllOn!(visibleGroups(), visibleRemovals())}
              >
                TOGGLE ALL ON
              </button>
            </Show>
            <Show when={props.onToggleAllOff}>
              <button
                class="tui-button tui-button--danger"
                onClick={() => props.onToggleAllOff!(visibleGroups())}
              >
                TOGGLE ALL OFF
              </button>
            </Show>
          </div>
        </Show>
        <div role="list" aria-label={`${props.side} games`}>
          <For each={visibleGroups()}>
            {(g) => (
              <GameRow
                prefix={g.prefix}
                files={g.files}
                state={
                  g.files.some((f) => props.isFileSelected(f)) ? "selected" : "unselected"
                }
                isFileChecked={(f) => props.isFileSelected(f)}
                onTogglePrefix={
                  props.side === "destination"
                    ? props.onClearPrefix
                      ? () => props.onClearPrefix?.(g.files)
                      : undefined
                    : props.onTogglePrefix
                      ? () => props.onTogglePrefix?.(g.files)
                      : undefined
                }
                onToggleFile={props.onToggleFile}
                onContextFile={props.onContextFile}
              />
            )}
          </For>
          <Show when={props.side === "destination" && visibleRemovals().length > 0}>
            <div style={{ "margin-top": "10px" }}>
              <h3 class="text-danger">TO BE REMOVED ON SYNC</h3>
              <For each={visibleRemovals()}>
                {(f) => (
                  <GameRow
                    prefix={f}
                    files={[f]}
                    state="removing"
                    isFileChecked={() => true}
                    disabled={true}
                  />
                )}
              </For>
            </div>
          </Show>
          <Show when={props.side === "destination" && visibleExtras().length > 0}>
            <div style={{ "margin-top": "10px" }}>
              <h3 class="text-amber">EXTRA FILES (NO SOURCE COUNTERPART)</h3>
              <For each={visibleExtras()}>
                {(f) => (
                  <GameRow
                    prefix={f}
                    files={[f]}
                    state="orphan"
                    isFileChecked={() => true}
                    disabled={true}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
