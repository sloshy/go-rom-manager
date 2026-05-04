import { Component, For, Show, createSignal } from 'solid-js'

export interface ManualGroupMenuProps {
  filename: string
  x: number
  y: number
  prefixes: string[]
  currentGroup: string | null
  onPick: (target: string) => void
  onUnmerge: () => void
  onClose: () => void
}

export const ManualGroupMenu: Component<ManualGroupMenuProps> = (props) => {
  const [mode, setMode] = createSignal<'root' | 'pick' | 'new'>('root')
  const [filter, setFilter] = createSignal('')
  const [newName, setNewName] = createSignal('')

  const filtered = () => {
    const f = filter().toLowerCase()
    return props.prefixes.filter((p) => p.toLowerCase().includes(f))
  }

  return (
    <div
      class="context-menu"
      role="menu"
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <Show when={mode() === 'root'}>
        <div class="item" onClick={() => setMode('pick')}>
          MERGE INTO GROUP...
        </div>
        <div class="item" onClick={() => setMode('new')}>
          NEW GROUP...
        </div>
        <Show when={props.currentGroup}>
          <div
            class="item"
            onClick={() => {
              props.onUnmerge()
              props.onClose()
            }}
          >
            UNMERGE
          </div>
        </Show>
        <div class="item" onClick={props.onClose}>
          CANCEL
        </div>
      </Show>
      <Show when={mode() === 'pick'}>
        <div style={{ padding: '6px 12px' }}>
          <input
            type="search"
            value={filter()}
            placeholder="filter prefixes..."
            onInput={(e) => setFilter(e.currentTarget.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ 'max-height': '180px', overflow: 'auto' }}>
          <For each={filtered()}>
            {(p) => (
              <div
                class="item"
                onClick={() => {
                  props.onPick(p)
                  props.onClose()
                }}
              >
                {p}
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={mode() === 'new'}>
        <div style={{ padding: '6px 12px' }}>
          <input
            type="text"
            value={newName()}
            placeholder="new prefix..."
            onInput={(e) => setNewName(e.currentTarget.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div
          class="item"
          onClick={() => {
            const t = newName().trim()
            if (t) {
              props.onPick(t)
              props.onClose()
            }
          }}
        >
          CREATE
        </div>
      </Show>
    </div>
  )
}
