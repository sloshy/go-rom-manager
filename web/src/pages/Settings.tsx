import { Component, Show, createSignal, onMount } from 'solid-js'
import { A } from '@solidjs/router'
import { api } from '../api/client'
import { PreferenceEditor } from '../components/PreferenceEditor'

export const Settings: Component = () => {
  const [items, setItems] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<string[]>([])
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [savedAt, setSavedAt] = createSignal<number | null>(null)

  onMount(async () => {
    try {
      const data = await api.getSettings()
      setItems(data.preferences)
      setDefaults(data.defaultPreferences)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  })

  const onChange = (next: string[]) => {
    setItems(next)
    setDirty(true)
  }

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await api.updateSettings(items())
      setItems(result.preferences)
      setDirty(false)
      setSavedAt(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = () => {
    setItems([...defaults()])
    setDirty(true)
  }

  return (
    <div class="settings-page">
      <div class="row" style={{ 'margin-bottom': '8px' }}>
        <h2 style={{ margin: 0 }}>GLOBAL PREFERENCES</h2>
        <A href="/" class="crumbs" style={{ 'margin-left': 'auto' }}>
          [BACK]
        </A>
      </div>

      <div class="tui-panel">
        <div class="tui-titlebar">
          <span>AUTO-SELECT PRIORITY</span>
        </div>
        <div class="panel-body">
          <p class="text-dim" style={{ margin: 0 }}>
            When a game has multiple variants, auto-select walks this list top to bottom. The first
            tag that matches at least one variant wins. Demo/Proto are always filtered out when
            alternatives exist; ties are broken by highest Rev.
          </p>

          <Show when={!loading()} fallback={<div class="text-dim">Loading...</div>}>
            <PreferenceEditor items={items()} onChange={onChange} disabled={saving()} />
          </Show>

          <Show when={error()}>
            <div class="text-danger">! {error()}</div>
          </Show>

          <div class="settings-actions">
            <button
              type="button"
              class="tui-button tui-button--save"
              disabled={saving() || !dirty()}
              onClick={save}
            >
              {saving() ? 'SAVING...' : 'SAVE'}
            </button>
            <button type="button" class="tui-button" disabled={saving()} onClick={resetToDefault}>
              RESET TO DEFAULT
            </button>
            <Show when={savedAt() && !dirty()}>
              <span class="text-green">// SAVED</span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
