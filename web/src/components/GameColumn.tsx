import { Component, For, JSX, Show, createMemo, createSignal } from 'solid-js'
import { FilterChipInput } from './FilterChipInput'
import { GameRow } from './GameRow'
import { TagFilterMenu } from './TagFilterMenu'
import { ExtFilterMenu, type ExtFilter } from './ExtFilterMenu'
import { bundleByVariant, fileExt, type GameGroup } from '../lib/games'
import {
  collectTagTokens,
  fileMatchesTags,
  groupMatchesTags,
  hasActiveTagFilters,
  matchesChips,
  type FilterChip,
  type TagFilters,
} from '../lib/tags'

export interface GameColumnProps {
  title: string
  /** Optional interactive element rendered after the title (e.g. the source switcher). */
  titleMenu?: JSX.Element
  side: 'source' | 'destination'
  groups: GameGroup[]
  /** Optional per-file subtext (e.g. which source a dest file comes from). */
  fileSubtext?: (filename: string) => string | undefined
  /** Destination files the user has just deselected (was managed, now isn't). */
  filesToRemove?: string[]
  /** Destination files with no source counterpart (locked, must persist). */
  extraFiles?: string[]
  isFileSelected: (filename: string) => boolean
  onToggleFile?: (filename: string) => void
  /**
   * Toggle a multi-file bundle as a unit. Fires from per-bundle
   * checkboxes on either side; receives the bundle's raw files (the
   * editor handles deduping and source-name resolution).
   */
  onToggleBundle?: (files: string[]) => void
  /** Source-side: toggle prefix selection on/off (auto-pick best variant). */
  onTogglePrefix?: (files: string[]) => void
  /** Destination-side: clear all selected files in the displayed group. */
  onClearPrefix?: (files: string[]) => void
  onContextFile?: (filename: string, evt: MouseEvent) => void
  /**
   * Toggle All On: source = auto-select best variant per visible group;
   * destination = restore visible files-to-remove back into selected.
   * Receives the currently visible groups and removals so the handler can act
   * only on what the filter shows.
   */
  onToggleAllOn?: (groups: GameGroup[], removals: string[]) => void
  /** Toggle All Off: deselect all files in every visible group. */
  onToggleAllOff?: (groups: GameGroup[]) => void
}

export const GameColumn: Component<GameColumnProps> = (props) => {
  const [filterChips, setFilterChips] = createSignal<FilterChip[]>([])
  const [tagFilters, setTagFilters] = createSignal<TagFilters>({})
  const [extFilter, setExtFilter] = createSignal<ExtFilter | null>(null)
  const [filterGroupedItems, setFilterGroupedItems] = createSignal(false)

  const tagsActive = createMemo(() => hasActiveTagFilters(tagFilters()))

  const allColumnFiles = createMemo(() => [
    ...props.groups.flatMap((g) => g.files),
    ...(props.filesToRemove ?? []),
    ...(props.extraFiles ?? []),
  ])

  const tokens = createMemo(() => collectTagTokens(allColumnFiles()))

  const extensions = createMemo(() => {
    const exts = new Set<string>()
    for (const f of allColumnFiles()) {
      const ext = fileExt(f)
      if (ext) exts.add(ext)
    }
    return [...exts].sort()
  })

  const fileMatchesExt = (filename: string, ef: ExtFilter | null): boolean => {
    if (!ef) return true
    const ext = fileExt(filename)
    return ef.state === 'positive' ? ext === ef.ext : ext !== ef.ext
  }

  const groupMatchesExt = (files: string[], ef: ExtFilter | null): boolean => {
    if (!ef) return true
    return ef.state === 'positive'
      ? files.some((f) => fileExt(f) === ef.ext)
      : files.every((f) => fileExt(f) !== ef.ext)
  }

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
    const chips = filterChips()
    const tags = tagFilters()
    const ef = extFilter()
    const grouped = filterGroupedItems()
    const tagsOn = tagsActive()

    const out: GameGroup[] = []
    for (const g of props.groups) {
      if (!matchesChips(g.prefix, chips)) continue
      if (!tagsOn && !ef) {
        out.push(g)
        continue
      }
      if (grouped) {
        let files = g.files
        if (tagsOn) files = files.filter((f) => fileMatchesTags(f, tags))
        if (ef) files = files.filter((f) => fileMatchesExt(f, ef))
        if (files.length === 0) continue
        out.push({ prefix: g.prefix, files })
      } else {
        if (tagsOn && !groupMatchesTags(g.files, tags)) continue
        if (!groupMatchesExt(g.files, ef)) continue
        out.push(g)
      }
    }
    return out
  })

  const flatFileVisible = (f: string): boolean => {
    if (!matchesChips(f, filterChips())) return false
    if (tagsActive() && !fileMatchesTags(f, tagFilters())) return false
    if (!fileMatchesExt(f, extFilter())) return false
    return true
  }

  const visibleRemovals = createMemo(() => (props.filesToRemove ?? []).filter(flatFileVisible))

  const visibleExtras = createMemo(() => (props.extraFiles ?? []).filter(flatFileVisible))

  /**
   * Pre-computed bundle views: derive once per (filter or input) change
   * and read inside `<For>` instead of recomputing `bundleByVariant`
   * every iteration. Each visible group projects to (group, bundles)
   * so the row can read `bundles` without paying the bundling cost on
   * unrelated reactive updates.
   */
  const visibleBundledGroups = createMemo(() =>
    visibleGroups().map((g) => ({ group: g, bundles: bundleByVariant(g.files) })),
  )
  const removalBundles = createMemo(() => bundleByVariant(visibleRemovals()))
  const extraBundles = createMemo(() => bundleByVariant(visibleExtras()))

  return (
    <div class="tui-panel">
      <div class="tui-titlebar">
        <span class="tui-titlebar__title">
          {props.title}
          <Show when={props.titleMenu}>{props.titleMenu}</Show>
        </span>
        <span class="text-dim">{props.groups.length} TITLES</span>
      </div>
      <div style={{ padding: '10px 10px 0' }}>
        <FilterChipInput chips={filterChips()} onChange={setFilterChips}>
          <ExtFilterMenu
            extensions={extensions()}
            filter={extFilter()}
            onFilterChange={setExtFilter}
          />
          <TagFilterMenu
            tokens={tokens()}
            filters={tagFilters()}
            onFilterChange={setTagFilters}
            filterGroupedItems={filterGroupedItems()}
            onToggleGroupedItems={setFilterGroupedItems}
          />
        </FilterChipInput>
        <Show when={props.onToggleAllOn || props.onToggleAllOff}>
          <div class="row" style={{ 'margin-top': '8px', gap: '6px' }}>
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
      </div>
      <div style={{ flex: 1, 'overflow-y': 'auto', 'min-height': 0, padding: '8px 10px 10px' }}>
        <div role="list" aria-label={`${props.side} games`}>
          <For each={visibleBundledGroups()}>
            {({ group: g, bundles }) => (
              <GameRow
                prefix={g.prefix}
                files={g.files}
                bundles={bundles}
                state={g.files.some((f) => props.isFileSelected(f)) ? 'selected' : 'unselected'}
                isFileChecked={(f) => props.isFileSelected(f)}
                onTogglePrefix={
                  props.side === 'destination'
                    ? props.onClearPrefix
                      ? () => props.onClearPrefix?.(g.files)
                      : undefined
                    : props.onTogglePrefix
                      ? () => props.onTogglePrefix?.(g.files)
                      : undefined
                }
                onToggleFile={props.onToggleFile}
                onToggleBundle={props.onToggleBundle}
                onContextFile={props.onContextFile}
                fileSubtext={props.fileSubtext}
              />
            )}
          </For>
          <Show when={props.side === 'destination' && visibleRemovals().length > 0}>
            <div style={{ 'margin-top': '10px' }}>
              <h3 class="text-danger">TO BE REMOVED ON SYNC</h3>
              <For each={removalBundles()}>
                {(b) => (
                  <GameRow
                    prefix={b.files.length > 1 ? b.label : b.files[0]}
                    files={b.files}
                    bundles={[b]}
                    state="removing"
                    isFileChecked={() => true}
                    disabled={true}
                  />
                )}
              </For>
            </div>
          </Show>
          <Show when={props.side === 'destination' && visibleExtras().length > 0}>
            <div style={{ 'margin-top': '10px' }}>
              <h3 class="text-amber">EXTRA FILES (NO SOURCE COUNTERPART)</h3>
              <For each={extraBundles()}>
                {(b) => (
                  <GameRow
                    prefix={b.files.length > 1 ? b.label : b.files[0]}
                    files={b.files}
                    bundles={[b]}
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
  )
}
