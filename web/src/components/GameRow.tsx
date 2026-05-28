import { Component, For, Show } from 'solid-js'
import type { FileBundle } from '../lib/games'

export interface GameRowProps {
  prefix: string
  files: string[]
  /**
   * When set, the row renders one line per bundle (a variant + its
   * files) instead of one line per file. Multi-file bundles like
   * cue+multiple-bin are toggled atomically: clicking calls
   * `onToggleBundle(bundle.files)` which the editor toggles in/out as
   * a unit. Single-file bundles show the bare filename.
   */
  bundles?: FileBundle[]
  state: 'selected' | 'unselected' | 'orphan' | 'removing'
  isFileChecked: (filename: string) => boolean
  onToggleFile?: (filename: string) => void
  onToggleBundle?: (files: string[]) => void
  onTogglePrefix?: () => void
  onContextFile?: (filename: string, evt: MouseEvent) => void
  /** Optional small caption under a file (e.g. the source it comes from). */
  fileSubtext?: (filename: string) => string | undefined
  disabled?: boolean
}

export const GameRow: Component<GameRowProps> = (props) => {
  const stateClass = () => {
    if (props.state === 'selected') return 'is-selected'
    if (props.state === 'orphan') return 'is-orphan'
    if (props.state === 'removing') return 'is-removing'
    return ''
  }

  return (
    <div class={`game-row ${stateClass()}`}>
      <div class="row" style={{ gap: '8px' }}>
        <Show when={props.onTogglePrefix}>
          <input
            type="checkbox"
            class="tui-checkbox"
            aria-label={`toggle ${props.prefix}`}
            checked={props.state === 'selected'}
            disabled={props.disabled}
            onChange={() => props.onTogglePrefix?.()}
          />
        </Show>
        <span class="game-prefix">{props.prefix}</span>
        <span class="text-muted" style={{ 'margin-left': 'auto' }}>
          {props.files.length} file{props.files.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul class="game-files">
        <Show
          when={props.bundles}
          fallback={
            <For each={props.files}>
              {(f) => (
                <li
                  class={props.isFileChecked(f) ? 'is-checked' : ''}
                  onContextMenu={(e) => {
                    if (props.onContextFile) {
                      e.preventDefault()
                      props.onContextFile(f, e)
                    }
                  }}
                >
                  <Show when={props.onToggleFile || props.disabled}>
                    <input
                      type="checkbox"
                      class="tui-checkbox"
                      aria-label={f}
                      checked={props.isFileChecked(f)}
                      disabled={props.disabled || !props.onToggleFile}
                      onChange={() => props.onToggleFile?.(f)}
                    />
                  </Show>
                  <span class="file-cell">
                    <span class="filename">{f}</span>
                    <Show when={props.fileSubtext?.(f)}>
                      {(sub) => <span class="file-source text-muted">from {sub()}</span>}
                    </Show>
                  </span>
                </li>
              )}
            </For>
          }
        >
          <For each={props.bundles}>
            {(b) => {
              // For toggle: any file in the bundle is enough — toggleBundle
              // dedupes downstream. For "checked": treat the bundle as
              // checked if ANY underlying file is selected (keeps a partial
              // state from rendering as off; click then deselects all).
              const head = b.files[0]
              const isMulti = b.files.length > 1
              const checked = () => b.files.some((f) => props.isFileChecked(f))
              const label = () => (isMulti ? b.label : head)
              const interactive = () => props.onToggleBundle || props.onToggleFile
              return (
                <li
                  class={checked() ? 'is-checked' : ''}
                  onContextMenu={(e) => {
                    if (props.onContextFile) {
                      e.preventDefault()
                      props.onContextFile(head, e)
                    }
                  }}
                >
                  <Show when={interactive() || props.disabled}>
                    <input
                      type="checkbox"
                      class="tui-checkbox"
                      aria-label={label()}
                      checked={checked()}
                      disabled={props.disabled || !interactive()}
                      onChange={() => {
                        if (props.onToggleBundle) props.onToggleBundle(b.files)
                        else props.onToggleFile?.(head)
                      }}
                    />
                  </Show>
                  <span class="file-cell">
                    <span class="file-line">
                      <span class="filename">{label()}</span>
                      <Show when={isMulti}>
                        <span class="bundle-exts text-muted" style={{ 'margin-left': '6px' }}>
                          <For each={b.extensions}>
                            {(ext) => <span class="bundle-ext">[{ext.replace(/^\./, '')}]</span>}
                          </For>
                        </span>
                      </Show>
                    </span>
                    <Show when={props.fileSubtext?.(head)}>
                      {(sub) => <span class="file-source text-muted">from {sub()}</span>}
                    </Show>
                  </span>
                </li>
              )
            }}
          </For>
        </Show>
      </ul>
    </div>
  )
}
