import { Component } from 'solid-js'

export interface SyncToolbarProps {
  toCopy: number
  toDelete: number
  /** True when the user has staged any in-memory edit since load. */
  dirty: boolean
  onSync: () => void
  syncing: boolean
}

export const SyncToolbar: Component<SyncToolbarProps> = (props) => {
  const canSync = () => !props.syncing && (props.dirty || props.toCopy > 0 || props.toDelete > 0)

  return (
    <div class="app-footer">
      <span class="text-dim">PENDING DIFF:</span>
      <span class="text-green">+{props.toCopy}</span>
      <span class="text-dim">/</span>
      <span class="text-amber">-{props.toDelete}</span>
      <div style={{ 'margin-left': 'auto' }}>
        <button class="tui-button" onClick={props.onSync} disabled={!canSync()}>
          {props.syncing ? 'SYNCING...' : 'SYNC'}
        </button>
      </div>
    </div>
  )
}
