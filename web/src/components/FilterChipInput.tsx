import { Component, For, JSX, Show, createSignal } from 'solid-js'
import { commitFilterDraft, tokenizeFilterInput, type FilterChip } from '../lib/tags'

export interface FilterChipInputProps {
  chips: FilterChip[]
  onChange: (chips: FilterChip[]) => void
  placeholder?: string
  /** Optional trailing controls rendered inline (e.g. tag-filter dropdown). */
  children?: JSX.Element
}

/**
 * Chip-style filter input. Each whitespace-separated token becomes a
 * chip; quoted `"..."` spans keep internal whitespace; a leading `-`
 * marks a negative (substring exclusion) chip. Mirrors the existing
 * `TagInput` chip UX but uses space (not comma) as the delimiter so the
 * input reads like a normal search query.
 */
export const FilterChipInput: Component<FilterChipInputProps> = (props) => {
  const [draft, setDraft] = createSignal('')
  let inputRef!: HTMLInputElement

  const setDraftAndDOM = (v: string) => {
    setDraft(v)
    if (inputRef) inputRef.value = v
  }

  /**
   * Append `incoming` to the existing chip list, dropping silent
   * duplicates. Two chips are equal when their lowercased text and
   * negative flag match — so a positive "Gun" and a negative "Gun" can
   * coexist (the matcher will simply reject everything, but that's the
   * user's problem).
   */
  const appendChips = (incoming: FilterChip[]) => {
    if (incoming.length === 0) return
    const seen = new Set(props.chips.map((c) => `${c.negative ? '-' : '+'}${c.text.toLowerCase()}`))
    const next = [...props.chips]
    for (const c of incoming) {
      const key = `${c.negative ? '-' : '+'}${c.text.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      next.push(c)
    }
    if (next.length !== props.chips.length) props.onChange(next)
  }

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const raw = e.currentTarget.value
    const { chips, remainder } = tokenizeFilterInput(raw)
    if (chips.length > 0) {
      appendChips(chips)
      setDraftAndDOM(remainder)
    } else {
      setDraft(raw)
    }
  }

  const flushDraft = () => {
    const c = commitFilterDraft(draft())
    if (c) appendChips([c])
    setDraftAndDOM('')
  }

  const onKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      flushDraft()
    } else if (e.key === 'Backspace' && draft() === '' && props.chips.length > 0) {
      e.preventDefault()
      props.onChange(props.chips.slice(0, -1))
    }
  }

  const onBlur = () => {
    if (draft().trim() !== '') flushDraft()
  }

  const remove = (index: number) => {
    props.onChange(props.chips.filter((_, i) => i !== index))
  }

  return (
    <div class="row" style={{ 'margin-bottom': '8px' }}>
      <div class="filter-chip-input" role="group" style={{ flex: 1 }}>
        <For each={props.chips}>
          {(chip, index) => (
            <span class={`filter-chip is-${chip.negative ? 'negative' : 'positive'}`}>
              <span class="filter-chip__sign" aria-hidden="true">
                {chip.negative ? '−' : '+'}
              </span>
              <span class="filter-chip__text">{chip.text}</span>
              <button
                type="button"
                class="filter-chip__remove"
                aria-label={`Remove ${chip.negative ? 'negative ' : ''}filter ${chip.text}`}
                onClick={() => remove(index())}
              >
                ×
              </button>
            </span>
          )}
        </For>
        <input
          ref={inputRef}
          type="search"
          class="filter-chip-input__field"
          value={draft()}
          placeholder={props.chips.length === 0 ? (props.placeholder ?? 'type to filter...') : ''}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </div>
      <Show when={props.children}>{props.children}</Show>
    </div>
  )
}
