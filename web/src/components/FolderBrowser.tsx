import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js'
import { api, type BrowseEntry } from '../api/client'

export interface FolderBrowserProps {
  /** Allowed root paths (one of the configured --source / --dest dirs). */
  roots: string[]
  /** Called whenever the highlighted path changes (including initial mount). */
  onSelect?: (path: string) => void
  /** Pre-select a specific root on mount (must be one of roots). */
  initialRoot?: string
  /** Pre-navigate to this sub-path within initialRoot on mount. */
  initialSub?: string
}

export const FolderBrowser: Component<FolderBrowserProps> = (props) => {
  const initialRoot =
    props.initialRoot && props.roots.includes(props.initialRoot)
      ? props.initialRoot
      : (props.roots[0] ?? '')
  const [activeRoot, setActiveRoot] = createSignal(initialRoot)
  const [sub, setSub] = createSignal(props.initialSub ?? '')

  const [data] = createResource(
    () => ({ root: activeRoot(), sub: sub() }),
    async ({ root, sub }) => {
      if (!root) return { path: '', entries: [] as BrowseEntry[] }
      return api.browse(root, sub)
    },
  )

  const currentPath = createMemo(() => {
    const r = activeRoot()
    if (!r) return ''
    const s = sub()
    return s ? `${r}/${s}` : r
  })

  // Propagate the current selection to the parent on mount and whenever it
  // changes (root switch, drill-in, jump up via breadcrumb). This is what
  // makes the root itself selectable — the initial mount value is the root.
  createEffect(() => {
    const p = currentPath()
    if (p) props.onSelect?.(p)
  })

  const enter = (entry: BrowseEntry) => {
    if (!entry.isDir) return
    setSub(sub() ? `${sub()}/${entry.name}` : entry.name)
  }

  const jumpToSub = (next: string) => setSub(next)

  const segments = createMemo(() => sub().split('/').filter(Boolean))

  // Each crumb is the cumulative sub-path that clicking it should jump to.
  const crumbs = createMemo<{ label: string; sub: string }[]>(() => {
    const parts = segments()
    const out: { label: string; sub: string }[] = []
    for (let i = 0; i < parts.length; i++) {
      out.push({ label: parts[i], sub: parts.slice(0, i + 1).join('/') })
    }
    return out
  })

  const switchRoot = (root: string) => {
    setActiveRoot(root)
    setSub('')
  }

  return (
    <div>
      <Show when={props.roots.length > 1}>
        <div class="row" style={{ 'margin-bottom': '8px' }}>
          <span class="text-dim">ROOT:</span>
          <For each={props.roots}>
            {(r) => (
              <button
                class={`tui-button ${r === activeRoot() ? '' : 'tui-button--amber'}`}
                onClick={() => switchRoot(r)}
              >
                {r}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="folder-browser">
        <div class="crumb">
          PATH:{' '}
          <button
            type="button"
            class="crumb-link"
            aria-label="jump to root"
            onClick={() => jumpToSub('')}
          >
            {activeRoot() || '(no root)'}
          </button>
          <For each={crumbs()}>
            {(c) => (
              <>
                <span class="crumb-sep"> / </span>
                <button
                  type="button"
                  class="crumb-link"
                  aria-label={`jump to ${c.sub}`}
                  onClick={() => jumpToSub(c.sub)}
                >
                  {c.label}
                </button>
              </>
            )}
          </For>
        </div>
        <Show when={sub() !== ''}>
          <div
            class="entry is-dir"
            aria-label="parent folder"
            onClick={() => {
              const parts = segments()
              parts.pop()
              jumpToSub(parts.join('/'))
            }}
          >
            ..
          </div>
        </Show>
        <For each={(data()?.entries ?? []).filter((e) => e.isDir)}>
          {(entry) => (
            <div class="entry is-dir" onClick={() => enter(entry)}>
              {entry.name}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
