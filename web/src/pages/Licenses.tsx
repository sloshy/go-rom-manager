import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { A } from '@solidjs/router'
import { api, LicenseEntry, LicenseManifest } from '../api/client'

export const Licenses: Component = () => {
  const [manifest, setManifest] = createSignal<LicenseManifest | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal('')
  const [openKey, setOpenKey] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      setManifest(await api.getLicenses())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  })

  const matches = (e: LicenseEntry) => {
    const q = filter().trim().toLowerCase()
    if (!q) return true
    return (
      e.name.toLowerCase().includes(q) ||
      e.license.toLowerCase().includes(q) ||
      e.version.toLowerCase().includes(q)
    )
  }

  const goEntries = createMemo(() => (manifest()?.go ?? []).filter(matches))
  const jsEntries = createMemo(() => (manifest()?.js ?? []).filter(matches))
  const totalAvailable = createMemo(
    () => (manifest()?.go.length ?? 0) + (manifest()?.js.length ?? 0),
  )

  const toggle = (k: string) => setOpenKey((prev) => (prev === k ? null : k))

  return (
    <div class="settings-page">
      <div class="row" style={{ 'margin-bottom': '8px' }}>
        <h2 style={{ margin: 0 }}>LICENSES</h2>
        <A href="/" class="crumbs" style={{ 'margin-left': 'auto' }}>
          [BACK]
        </A>
      </div>

      <Show when={error()}>
        <div class="text-danger">! {error()}</div>
      </Show>

      <Show when={loading()}>
        <div class="text-dim">Loading...</div>
      </Show>

      <Show when={manifest()}>
        <div class="tui-panel">
          <div class="tui-titlebar">
            <span>DEPENDENCY ATTRIBUTION</span>
            <span class="text-dim">
              {goEntries().length + jsEntries().length} / {totalAvailable()}
            </span>
          </div>
          <div class="panel-body">
            <p class="text-dim" style={{ margin: 0 }}>
              Every library statically linked into the binary or bundled into the SPA is listed
              below. Click an entry to expand its full license text. Use{' '}
              <code>./rom-manager --licenses</code> or{' '}
              <code>./rom-manager --license &lt;name&gt;</code> for the same data on the command
              line.
            </p>

            <input
              type="search"
              aria-label="Filter dependencies"
              placeholder="filter by name, version, or license"
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              style={{ width: '100%' }}
            />

            <LicenseGroup
              label="Go"
              entries={goEntries()}
              openKey={openKey()}
              onToggle={toggle}
              keyPrefix="go"
            />
            <LicenseGroup
              label="JavaScript"
              entries={jsEntries()}
              openKey={openKey()}
              onToggle={toggle}
              keyPrefix="js"
            />
          </div>
        </div>
      </Show>
    </div>
  )
}

export const LicenseGroup: Component<{
  label: string
  entries: LicenseEntry[]
  openKey: string | null
  onToggle: (key: string) => void
  keyPrefix: string
}> = (props) => (
  <section class="license-group">
    <h3 class="license-group__heading">
      {props.label.toUpperCase()} <span class="text-dim">({props.entries.length})</span>
    </h3>
    <Show
      when={props.entries.length}
      fallback={<div class="text-dim license-group__empty">// no matches</div>}
    >
      <ul class="license-list">
        <For each={props.entries}>
          {(entry) => {
            const key = `${props.keyPrefix}:${entry.name}@${entry.version}`
            const isOpen = () => props.openKey === key
            return (
              <li class="license-item" classList={{ 'license-item--open': isOpen() }}>
                <button
                  type="button"
                  class="license-item__row"
                  aria-expanded={isOpen()}
                  onClick={() => props.onToggle(key)}
                >
                  <span class="license-item__name">{entry.name}</span>
                  <Show when={entry.version}>
                    <span class="license-item__version text-dim">{entry.version}</span>
                  </Show>
                  <span class="license-item__license">{entry.license || '(unknown)'}</span>
                  <span class="license-item__caret text-dim">{isOpen() ? '−' : '+'}</span>
                </button>
                <Show when={isOpen()}>
                  <pre class="license-item__text">{entry.text}</pre>
                </Show>
              </li>
            )
          }}
        </For>
      </ul>
    </Show>
  </section>
)
