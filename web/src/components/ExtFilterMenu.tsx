import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js'

export type ExtFilterState = 'positive' | 'negative'

export interface ExtFilter {
  ext: string
  state: ExtFilterState
}

export interface ExtFilterMenuProps {
  extensions: readonly string[]
  filter: ExtFilter | null
  onFilterChange: (filter: ExtFilter | null) => void
}

export const ExtFilterMenu: Component<ExtFilterMenuProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  let rootRef!: HTMLDivElement

  const onDocClick = (e: MouseEvent) => {
    if (!rootRef || e.composedPath().includes(rootRef)) return
    setOpen(false)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
  }

  onMount(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    })
  })

  const cycle = (ext: string) => {
    const cur = props.filter
    if (!cur || cur.ext !== ext) {
      props.onFilterChange({ ext, state: 'positive' })
    } else if (cur.state === 'positive') {
      props.onFilterChange({ ext, state: 'negative' })
    } else {
      props.onFilterChange(null)
    }
  }

  const stateOf = (ext: string): ExtFilterState | 'off' => {
    if (!props.filter || props.filter.ext !== ext) return 'off'
    return props.filter.state
  }

  const symbolFor = (s: ExtFilterState | 'off') =>
    s === 'positive' ? '+' : s === 'negative' ? '−' : '·'

  return (
    <div class="tag-filter-menu" ref={rootRef}>
      <button
        type="button"
        class="tui-button"
        aria-haspopup="true"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        {props.filter ? 'EXT FILTER (1)' : 'EXT FILTER'}
      </button>
      <Show when={open()}>
        <div class="tag-filter-menu__panel" role="dialog" aria-label="Extension filters">
          <div class="tag-filter-menu__header">
            <span class="text-dim">Extension</span>
            <Show when={props.filter !== null}>
              <button
                type="button"
                class="tui-button tui-button--danger"
                onClick={() => props.onFilterChange(null)}
              >
                CLEAR
              </button>
            </Show>
          </div>
          <Show
            when={props.extensions.length > 0}
            fallback={
              <div class="text-muted" style={{ padding: '8px' }}>
                No extensions detected.
              </div>
            }
          >
            <div class="tag-filter-menu__chips">
              <For each={props.extensions}>
                {(ext) => (
                  <button
                    type="button"
                    class={`tag-filter-chip is-${stateOf(ext)}`}
                    aria-label={`Filter extension ${ext}: ${stateOf(ext)}`}
                    aria-pressed={stateOf(ext) !== 'off'}
                    onClick={() => cycle(ext)}
                  >
                    <span class="tag-filter-chip__sign">{symbolFor(stateOf(ext))}</span>
                    <span class="tag-filter-chip__label">{ext}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
