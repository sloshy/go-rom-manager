import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { sourceLabel } from '../lib/paths'

export interface SourceDropdownProps {
  /** Configured source directories, in display order. */
  sources: string[]
  /** Currently active source path. */
  active: string
  /** The primary source path (loads first); marked in the menu. */
  primary: string
  onSelect: (path: string) => void
}

/**
 * Title-bar source switcher: renders the active source's short label as a
 * button that opens a menu of every configured source. Used in the
 * source column's title ("SOURCE // <dropdown>"). When a mapping has only
 * one source the label is shown without an interactive menu.
 */
export const SourceDropdown: Component<SourceDropdownProps> = (props) => {
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

  const single = () => props.sources.length <= 1

  return (
    <div class="source-dropdown" ref={rootRef}>
      <Show
        when={!single()}
        fallback={
          <span class="source-dropdown__static" title={props.active}>
            {sourceLabel(props.active)}
          </span>
        }
      >
        <button
          type="button"
          class="source-dropdown__button"
          aria-haspopup="true"
          aria-expanded={open()}
          title={props.active}
          onClick={() => setOpen((v) => !v)}
        >
          <span class="source-dropdown__label">{sourceLabel(props.active)}</span>
          <span class="source-dropdown__caret">▾</span>
        </button>
        <Show when={open()}>
          <div class="source-dropdown__panel" role="menu" aria-label="Switch source folder">
            <For each={props.sources}>
              {(path) => (
                <button
                  type="button"
                  class="source-dropdown__item"
                  classList={{ 'is-active': path === props.active }}
                  role="menuitemradio"
                  aria-checked={path === props.active}
                  title={path}
                  onClick={() => {
                    props.onSelect(path)
                    setOpen(false)
                  }}
                >
                  <span class="source-dropdown__item-label">{sourceLabel(path)}</span>
                  <Show when={path === props.primary}>
                    <span class="source-dropdown__primary">PRIMARY</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
