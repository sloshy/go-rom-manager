import { Component, For, Show } from 'solid-js'
import type { Mapping } from '../api/client'

export interface MappingListProps {
  mappings: Mapping[]
  onOpen: (id: string) => void
  onDelete?: (id: string) => void
}

export const MappingList: Component<MappingListProps> = (props) => (
  <div class="tui-panel">
    <div class="tui-titlebar">
      <span>EXISTING MAPPINGS</span>
      <span class="text-dim">{props.mappings.length} TOTAL</span>
    </div>
    <Show
      when={props.mappings.length > 0}
      fallback={
        <div style={{ padding: '16px' }} class="text-dim">
          No mappings yet. Create one below.
        </div>
      }
    >
      <ul class="tui-list">
        <For each={props.mappings}>
          {(m) => (
            <li>
              <div class="row row--space">
                <div>
                  <div class="text-green">{m.name}</div>
                  <div class="text-dim" style={{ 'font-size': '0.85em' }}>
                    {m.sourcePath} → {m.destPath}
                  </div>
                </div>
                <div class="row">
                  <button class="tui-button" onClick={() => props.onOpen(m.id)}>
                    OPEN
                  </button>
                  <Show when={props.onDelete}>
                    <button
                      class="tui-button tui-button--danger"
                      onClick={() => props.onDelete?.(m.id)}
                    >
                      DEL
                    </button>
                  </Show>
                </div>
              </div>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </div>
)
