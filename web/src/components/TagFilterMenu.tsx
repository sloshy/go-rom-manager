import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  activeTagFilterCount,
  nextTagFilterState,
  type TagFilters,
  type TagFilterState,
} from "../lib/tags";

export interface TagFilterMenuProps {
  /** Available tag tokens drawn from the column's filenames. */
  tokens: readonly string[];
  /** Current per-tag state. Owned by the parent. */
  filters: TagFilters;
  onFilterChange: (filters: TagFilters) => void;
  /** When true, tag filters narrow individual files within each group. */
  filterGroupedItems: boolean;
  onToggleGroupedItems: (v: boolean) => void;
}

/**
 * Dropdown of three-state tag toggles (off → positive → negative). The
 * trigger lives inline next to the column's filter input; the panel is
 * absolutely positioned beneath it. Outside-click closes; Escape too.
 */
export const TagFilterMenu: Component<TagFilterMenuProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let rootRef!: HTMLDivElement;

  const activeCount = createMemo(() => activeTagFilterCount(props.filters));

  const onDocClick = (e: MouseEvent) => {
    if (!rootRef || rootRef.contains(e.target as Node)) return;
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  };

  onMount(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  const cycle = (tag: string) => {
    const cur = props.filters[tag] ?? "off";
    const next = nextTagFilterState(cur);
    const out = { ...props.filters };
    if (next === "off") delete out[tag];
    else out[tag] = next;
    props.onFilterChange(out);
  };

  const clearAll = () => props.onFilterChange({});

  const stateOf = (tag: string): TagFilterState => props.filters[tag] ?? "off";

  const symbolFor = (s: TagFilterState) =>
    s === "positive" ? "+" : s === "negative" ? "−" : "·";

  return (
    <div class="tag-filter-menu" ref={rootRef}>
      <button
        type="button"
        class="tui-button"
        aria-haspopup="true"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        {(() => {
          const n = activeCount();
          return n > 0 ? `TAG FILTERS (${n})` : "TAG FILTERS";
        })()}
      </button>
      <Show when={open()}>
        <div class="tag-filter-menu__panel" role="dialog" aria-label="Tag filters">
          <div class="tag-filter-menu__header">
            <label class="row" style={{ gap: "6px" }}>
              <input
                type="checkbox"
                class="tui-checkbox"
                checked={props.filterGroupedItems}
                onChange={(e) => props.onToggleGroupedItems(e.currentTarget.checked)}
              />
              <span class="text-dim">Filter grouped items</span>
            </label>
            <Show when={activeCount() > 0}>
              <button type="button" class="tui-button tui-button--danger" onClick={clearAll}>
                CLEAR
              </button>
            </Show>
          </div>
          <Show
            when={props.tokens.length > 0}
            fallback={
              <div class="text-muted" style={{ padding: "8px" }}>
                No tags detected.
              </div>
            }
          >
            <div class="tag-filter-menu__chips">
              <For each={props.tokens}>
                {(tok) => (
                  <button
                    type="button"
                    class={`tag-filter-chip is-${stateOf(tok)}`}
                    aria-label={`Filter ${tok}: ${stateOf(tok)}`}
                    aria-pressed={stateOf(tok) !== "off"}
                    onClick={() => cycle(tok)}
                  >
                    <span class="tag-filter-chip__sign">{symbolFor(stateOf(tok))}</span>
                    <span class="tag-filter-chip__label">{tok}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
