import { Component, For, Show } from 'solid-js'

export interface GameRowProps {
  prefix: string
  files: string[]
  state: 'selected' | 'unselected' | 'orphan' | 'removing'
  isFileChecked: (filename: string) => boolean
  onToggleFile?: (filename: string) => void
  onTogglePrefix?: () => void
  onContextFile?: (filename: string, evt: MouseEvent) => void
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
              <span class="filename">{f}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
