import { Component, Show, createSignal, onMount } from 'solid-js'
import { A } from '@solidjs/router'
import { api } from '../api/client'
import { PreferenceEditor } from '../components/PreferenceEditor'
import { TagInput } from '../components/TagInput'

export const Settings: Component = () => {
  // Auto-select priority (ordered list).
  const [items, setItems] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<string[]>([])
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [savedAt, setSavedAt] = createSignal<number | null>(null)

  // Low-priority tags (unordered set).
  const [lowItems, setLowItems] = createSignal<string[]>([])
  const [lowDefaults, setLowDefaults] = createSignal<string[]>([])
  const [lowSaving, setLowSaving] = createSignal(false)
  const [lowDirty, setLowDirty] = createSignal(false)
  const [lowSavedAt, setLowSavedAt] = createSignal<number | null>(null)

  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [lowError, setLowError] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const data = await api.getSettings()
      setItems(data.preferences)
      setDefaults(data.defaultPreferences)
      setLowItems(data.lowPriorityTags)
      setLowDefaults(data.defaultLowPriorityTags)
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
      const result = await api.updateSettings({ preferences: items() })
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

  const onLowChange = (next: string[]) => {
    setLowItems(next)
    setLowDirty(true)
  }

  const saveLow = async () => {
    setLowError(null)
    setLowSaving(true)
    try {
      const result = await api.updateSettings({ lowPriorityTags: lowItems() })
      setLowItems(result.lowPriorityTags)
      setLowDirty(false)
      setLowSavedAt(Date.now())
    } catch (e) {
      setLowError((e as Error).message)
    } finally {
      setLowSaving(false)
    }
  }

  const resetLowToDefault = () => {
    setLowItems([...lowDefaults()])
    setLowDirty(true)
  }

  return (
    <div class="settings-page">
      <div class="row" style={{ 'margin-bottom': '8px' }}>
        <h2 style={{ margin: 0 }}>GLOBAL PREFERENCES</h2>
        <A href="/" class="crumbs" style={{ 'margin-left': 'auto' }}>
          [BACK]
        </A>
      </div>

      <div class="tui-panel" style={{ 'margin-bottom': '16px' }}>
        <div class="tui-titlebar">
          <span>AUTO-SELECT PRIORITY</span>
        </div>
        <div class="panel-body">
          <p class="text-dim" style={{ margin: 0 }}>
            When a game has multiple variants, auto-select walks this list top to bottom. The first
            tag that matches at least one variant wins. Low-priority variants are filtered out when
            alternatives exist (see below); ties are broken by highest Rev.
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

      <div class="tui-panel">
        <div class="tui-titlebar">
          <span>LOW PRIORITY TAGS</span>
        </div>
        <div class="panel-body">
          <p class="text-dim" style={{ margin: 0 }}>
            A variant carrying any of these tags is only auto-selected when its game has no cleaner
            alternative. For example, with <code>Sample</code> listed, <code>My Game (Sample)</code>{' '}
            is picked only when no plain <code>My Game</code> exists. Order doesn't matter; matching
            is case-insensitive. Leave empty to never demote any variant.
          </p>

          <Show when={!loading()} fallback={<div class="text-dim">Loading...</div>}>
            <div style={{ 'margin-top': '10px' }}>
              <TagInput
                items={lowItems()}
                placeholder="e.g. Demo Proto Sample (space, comma, or Enter)"
                disabled={lowSaving()}
                onChange={onLowChange}
              />
            </div>
          </Show>

          <Show when={lowError()}>
            <div class="text-danger">! {lowError()}</div>
          </Show>

          <div class="settings-actions">
            <button
              type="button"
              class="tui-button tui-button--save"
              disabled={lowSaving() || !lowDirty()}
              onClick={saveLow}
            >
              {lowSaving() ? 'SAVING...' : 'SAVE'}
            </button>
            <button
              type="button"
              class="tui-button"
              disabled={lowSaving()}
              onClick={resetLowToDefault}
            >
              RESET TO DEFAULT
            </button>
            <Show when={lowSavedAt() && !lowDirty()}>
              <span class="text-green">// SAVED</span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
