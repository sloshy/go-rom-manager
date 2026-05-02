import { Component, For, createSignal } from "solid-js";

export interface TagInputProps {
  /** Current tag list. Owned by the parent. */
  items: string[];
  /** Placeholder for the inline text field. */
  placeholder?: string;
  /** When true, no editing or removal is possible. */
  disabled?: boolean;
  /** Called whenever the tag list changes. */
  onChange: (items: string[]) => void;
  /**
   * Optional canonicalizer applied to each raw entry just before it is
   * committed as a tag. Returns the empty string to reject the entry.
   * If omitted, raw text is trimmed.
   */
  normalize?: (raw: string) => string;
}

const defaultNormalize = (raw: string) => raw.trim();

/**
 * Tag-style multi-value input: typing a comma (or pressing Enter) commits
 * the current draft as a chip with an × to remove. Backspace on an empty
 * field removes the last chip. Duplicates (post-normalize) are silently
 * dropped so paste-friendly inputs like "rvz, RVZ" round-trip cleanly.
 */
export const TagInput: Component<TagInputProps> = (props) => {
  const [draft, setDraft] = createSignal("");
  let inputRef!: HTMLInputElement;

  // resetDraft handles the case where setDraft("") is a no-op (signal
  // already empty) but the DOM still shows the user's typed text — e.g.
  // after a comma commit when draft was already "". Imperatively writing
  // the input value keeps signal and DOM in lockstep without resorting to
  // { equals: false } on every keystroke.
  const resetDraft = () => {
    setDraft("");
    if (inputRef) inputRef.value = "";
  };

  const norm = (raw: string) => (props.normalize ?? defaultNormalize)(raw);

  const commit = (raw: string) => {
    const value = norm(raw);
    if (!value) return;
    if (props.items.includes(value)) return;
    props.onChange([...props.items, value]);
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const raw = e.currentTarget.value;
    if (raw.includes(",")) {
      const parts = raw.split(",");
      const tail = parts.pop() ?? "";
      for (const p of parts) commit(p);
      setDraft(tail);
      if (inputRef) inputRef.value = tail;
    } else {
      setDraft(raw);
    }
  };

  const onKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (props.disabled) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft());
      resetDraft();
    } else if (e.key === "Backspace" && draft() === "" && props.items.length > 0) {
      e.preventDefault();
      props.onChange(props.items.slice(0, -1));
    }
  };

  const onBlur = () => {
    if (props.disabled) return;
    const raw = draft();
    resetDraft();
    if (raw.trim() !== "") commit(raw);
  };

  const remove = (index: number) => {
    props.onChange(props.items.filter((_, i) => i !== index));
  };

  return (
    <div class="tag-input" classList={{ "is-disabled": !!props.disabled }} role="list">
      <For each={props.items}>
        {(item, index) => (
          <span class="tag-chip" role="listitem">
            <span class="tag-chip__text">{item}</span>
            <button
              type="button"
              class="tag-chip__remove"
              disabled={props.disabled}
              onClick={() => remove(index())}
              aria-label={`Remove ${item}`}
            >
              ×
            </button>
          </span>
        )}
      </For>
      <input
        ref={inputRef}
        type="text"
        class="tag-input__field"
        value={draft()}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    </div>
  );
};
