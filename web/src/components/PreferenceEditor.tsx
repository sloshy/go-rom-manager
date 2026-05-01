import { Component, For, Show, createSignal } from "solid-js";

export interface PreferenceEditorProps {
  /** Items the editor renders. The component owns no list state itself. */
  items: string[];
  /** Whether inputs/handles are interactive. */
  disabled?: boolean;
  /** Called whenever the user edits, reorders, removes, or adds an item. */
  onChange: (items: string[]) => void;
}

/**
 * Editable, drag-to-reorder list of tag-preference strings used by the
 * settings pages. Pure controlled component: the parent owns the list,
 * the parent shows the save button.
 */
export const PreferenceEditor: Component<PreferenceEditorProps> = (props) => {
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);
  const [dropTarget, setDropTarget] = createSignal<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...props.items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    props.onChange(next);
  };

  const update = (index: number, value: string) => {
    const next = [...props.items];
    next[index] = value;
    props.onChange(next);
  };

  const remove = (index: number) => {
    const next = props.items.filter((_, i) => i !== index);
    props.onChange(next);
  };

  const add = () => {
    props.onChange([...props.items, ""]);
  };

  return (
    <div>
      <ul class="pref-list">
        <For
          each={props.items}
          fallback={
            <li class="pref-empty text-dim">
              No preferences. Auto-select will fall back to the highest revision.
            </li>
          }
        >
          {(item, index) => (
            <li
              class="pref-item"
              classList={{
                "is-dragging": dragIndex() === index(),
                "is-drop-target": dropTarget() === index() && dragIndex() !== index(),
              }}
              onDragOver={(e) => {
                if (dragIndex() === null) return;
                e.preventDefault();
                setDropTarget(index());
              }}
              onDragLeave={() => {
                if (dropTarget() === index()) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragIndex();
                if (from !== null) reorder(from, index());
                setDragIndex(null);
                setDropTarget(null);
              }}
            >
              <span
                class="pref-handle"
                draggable={!props.disabled}
                aria-label="Drag to reorder"
                title="Drag to reorder"
                onDragStart={(e) => {
                  setDragIndex(index());
                  e.dataTransfer?.setData("text/plain", String(index()));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropTarget(null);
                }}
              >
                ⋮⋮
              </span>
              <span class="pref-rank text-dim">{index() + 1}.</span>
              <input
                type="text"
                class="pref-input"
                value={item}
                disabled={props.disabled}
                placeholder="e.g. USA, World, Japan, Europe..."
                onInput={(e) => update(index(), e.currentTarget.value)}
              />
              <button
                type="button"
                class="tui-button tui-button--danger pref-remove"
                disabled={props.disabled}
                onClick={() => remove(index())}
                aria-label="Remove preference"
              >
                X
              </button>
            </li>
          )}
        </For>
      </ul>
      <div style={{ "margin-top": "10px" }}>
        <button type="button" class="tui-button" disabled={props.disabled} onClick={add}>
          + ADD PREFERENCE
        </button>
      </div>
      <Show when={hasDuplicates(props.items)}>
        <div class="text-danger" style={{ "margin-top": "8px" }}>
          ! Duplicate entries (case-insensitive) — these will be rejected on save.
        </div>
      </Show>
    </div>
  );
};

function hasDuplicates(items: string[]): boolean {
  const seen = new Set<string>();
  for (const raw of items) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) return true;
    seen.add(t);
  }
  return false;
}
