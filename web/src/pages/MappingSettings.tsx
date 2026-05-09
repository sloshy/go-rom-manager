import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { api, type AppConfigPayload } from '../api/client'
import { PreferenceEditor } from '../components/PreferenceEditor'
import { FolderBrowser } from '../components/FolderBrowser'
import { TagInput } from '../components/TagInput'

// Treat the allowed-extensions list as a set for dirty detection: the
// server normalizes to a canonical lowercase form and the matching rule
// doesn't care about order, so reordering chips shouldn't read as dirty.
function setsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const x of b) if (!sa.has(x)) return false
  return true
}

const normalizeExtension = (raw: string): string => {
  const t = raw.trim().replace(/^\./, '').trim().toLowerCase()
  return t ? '.' + t : ''
}

function splitPath(fullPath: string, roots: string[]): { root: string; sub: string } {
  for (const root of roots) {
    if (fullPath === root) return { root, sub: '' }
    if (fullPath.startsWith(root + '/')) return { root, sub: fullPath.slice(root.length + 1) }
  }
  return { root: roots[0] ?? '', sub: '' }
}

export const MappingSettings: Component = () => {
  const params = useParams<{ id: string }>()

  // Shared
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [mappingName, setMappingName] = createSignal<string>('')

  // Edit mapping details
  const [config, setConfig] = createSignal<AppConfigPayload | null>(null)
  const [editName, setEditName] = createSignal('')
  const [editSourcePath, setEditSourcePath] = createSignal('')
  const [editDestPath, setEditDestPath] = createSignal('')
  const [editAllowedExts, setEditAllowedExts] = createSignal<string[]>([])
  const [editExtractArchives, setEditExtractArchives] = createSignal(false)
  const [origName, setOrigName] = createSignal('')
  const [origSourcePath, setOrigSourcePath] = createSignal('')
  const [origDestPath, setOrigDestPath] = createSignal('')
  const [origAllowedExts, setOrigAllowedExts] = createSignal<string[]>([])
  const [origExtractArchives, setOrigExtractArchives] = createSignal(false)
  const [editSaving, setEditSaving] = createSignal(false)
  const [editError, setEditError] = createSignal<string | null>(null)
  const [editSavedAt, setEditSavedAt] = createSignal<number | null>(null)

  const editDirty = createMemo(
    () =>
      editName() !== origName() ||
      editSourcePath() !== origSourcePath() ||
      editDestPath() !== origDestPath() ||
      !setsEqual(editAllowedExts(), origAllowedExts()) ||
      editExtractArchives() !== origExtractArchives(),
  )

  // Preferences override
  const [globalPrefs, setGlobalPrefs] = createSignal<string[]>([])
  const [override, setOverride] = createSignal<string[] | null>(null)
  const [items, setItems] = createSignal<string[]>([])
  const [prefSaving, setPrefSaving] = createSignal(false)
  const [prefDirty, setPrefDirty] = createSignal(false)
  const [prefError, setPrefError] = createSignal<string | null>(null)
  const [prefSavedAt, setPrefSavedAt] = createSignal<number | null>(null)

  onMount(async () => {
    try {
      const [detail, settings, cfg] = await Promise.all([
        api.getMapping(params.id!),
        api.getSettings(),
        api.getConfig(),
      ])

      setMappingName(detail.mapping.name)
      setGlobalPrefs(settings.preferences)
      const stored = detail.mapping.preferences ?? null
      setOverride(stored)
      setItems(stored ?? settings.preferences)

      setConfig(cfg)
      setEditName(detail.mapping.name)
      setEditSourcePath(detail.mapping.sourcePath)
      setEditDestPath(detail.mapping.destPath)
      const exts = detail.mapping.allowedExtensions
      setEditAllowedExts(exts)
      setEditExtractArchives(detail.mapping.extractArchives)
      setOrigName(detail.mapping.name)
      setOrigSourcePath(detail.mapping.sourcePath)
      setOrigDestPath(detail.mapping.destPath)
      setOrigAllowedExts(exts)
      setOrigExtractArchives(detail.mapping.extractArchives)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setLoading(false)
    }
  })

  // Edit handlers
  const saveEdit = async () => {
    setEditError(null)
    if (!editName().trim() || !editSourcePath() || !editDestPath()) {
      setEditError('All fields required.')
      return
    }
    setEditSaving(true)
    try {
      const updated = await api.updateMapping(params.id!, {
        name: editName().trim(),
        sourcePath: editSourcePath(),
        destPath: editDestPath(),
        allowedExtensions: editAllowedExts(),
        extractArchives: editExtractArchives(),
      })
      setMappingName(updated.name)
      setOrigName(updated.name)
      setOrigSourcePath(updated.sourcePath)
      setOrigDestPath(updated.destPath)
      setOrigAllowedExts(updated.allowedExtensions)
      setOrigExtractArchives(updated.extractArchives)
      setEditAllowedExts(updated.allowedExtensions)
      setEditExtractArchives(updated.extractArchives)
      setEditName(updated.name)
      setEditSavedAt(Date.now())
    } catch (e) {
      setEditError((e as Error).message)
    } finally {
      setEditSaving(false)
    }
  }

  // Preferences handlers
  const onPrefsChange = (next: string[]) => {
    setItems(next)
    setPrefDirty(true)
  }

  const enableOverride = () => {
    setOverride([...items()])
    setPrefDirty(true)
  }

  const inheritGlobal = () => {
    setOverride(null)
    setItems([...globalPrefs()])
    setPrefDirty(true)
  }

  const isOverriding = () => override() !== null

  const savePrefs = async () => {
    setPrefError(null)
    setPrefSaving(true)
    try {
      const payload = isOverriding() ? items() : null
      const result = await api.updateMappingPreferences(params.id!, payload)
      setOverride(result.mapping.preferences ?? null)
      setItems(result.effectivePreferences)
      setPrefDirty(false)
      setPrefSavedAt(Date.now())
    } catch (e) {
      setPrefError((e as Error).message)
    } finally {
      setPrefSaving(false)
    }
  }

  return (
    <div class="settings-page">
      <div class="row" style={{ 'margin-bottom': '8px' }}>
        <h2 style={{ margin: 0 }}>MAPPING SETTINGS</h2>
        <Show when={mappingName()}>
          <span class="text-dim" style={{ 'margin-left': '12px' }}>
            // {mappingName()}
          </span>
        </Show>
        <A href={`/mapping/${params.id}`} class="crumbs" style={{ 'margin-left': 'auto' }}>
          [BACK]
        </A>
      </div>

      <Show when={loadError()}>
        <div class="text-danger">! {loadError()}</div>
      </Show>

      <div class="tui-panel" style={{ 'margin-bottom': '16px' }}>
        <div class="tui-titlebar">
          <span>EDIT MAPPING</span>
        </div>
        <div style={{ padding: '16px', display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
          <Show when={!loading()} fallback={<div class="text-dim">Loading...</div>}>
            <div>
              <label class="text-dim">NAME &gt;</label>
              <input
                type="text"
                value={editName()}
                onInput={(e) => setEditName(e.currentTarget.value)}
                style={{ width: '100%', 'margin-top': '4px' }}
                placeholder="e.g. SNES, Genesis, GBA..."
              />
            </div>
            <Show when={config()}>
              {(cfg) => {
                const srcInit = splitPath(editSourcePath(), cfg().sources)
                const dstInit = splitPath(editDestPath(), cfg().dests)
                return (
                  <>
                    <div>
                      <h3>SOURCE FOLDER</h3>
                      <FolderBrowser
                        roots={cfg().sources}
                        initialRoot={srcInit.root}
                        initialSub={srcInit.sub}
                        onSelect={setEditSourcePath}
                      />
                      <div class="text-dim" style={{ 'margin-top': '4px' }}>
                        Selected: <span class="text-green">{editSourcePath() || '(none)'}</span>
                      </div>
                    </div>
                    <div>
                      <h3>DESTINATION FOLDER</h3>
                      <FolderBrowser
                        roots={cfg().dests}
                        initialRoot={dstInit.root}
                        initialSub={dstInit.sub}
                        onSelect={setEditDestPath}
                      />
                      <div class="text-dim" style={{ 'margin-top': '4px' }}>
                        Selected: <span class="text-amber">{editDestPath() || '(none)'}</span>
                      </div>
                    </div>
                  </>
                )
              }}
            </Show>
            <div>
              <h3>ALLOWED ALT EXTENSIONS</h3>
              <p class="text-dim" style={{ margin: '0 0 6px' }}>
                Dest-side formats accepted as equivalents of a source file with the same basename.
                E.g. add <code>rvz</code> so that a converted
                <code> Game.rvz</code> in dest is treated as the same file as
                <code> Game.zip</code> in source — sync won't recopy or remove it. Leave empty to
                require exact filename matches.
              </p>
              <TagInput
                items={editAllowedExts()}
                placeholder="e.g. rvz cso chd (space, comma, or Enter)"
                disabled={editSaving()}
                onChange={setEditAllowedExts}
                normalize={normalizeExtension}
              />
            </div>
            <div>
              <h3>EXTRACT ARCHIVES</h3>
              <label class="row" style={{ gap: '8px', 'align-items': 'flex-start' }}>
                <input
                  type="checkbox"
                  class="tui-checkbox"
                  checked={editExtractArchives()}
                  disabled={editSaving()}
                  onChange={(e) => setEditExtractArchives(e.currentTarget.checked)}
                />
                <span>
                  <span>
                    Extract <code>.zip</code> files on sync
                  </span>
                  <p class="text-dim" style={{ margin: '4px 0 0' }}>
                    When enabled, .zip files are extracted into the destination instead of copied
                    verbatim. Inner filenames are preserved as-is (subdirectory structure is
                    flattened). Add the inner extensions to the allowed list above so extracted
                    files round-trip on reload — alt-ext matching uses the variant key (prefix +
                    non-track tags), so a zip's <code>.cue</code> plus its{' '}
                    <code>(Track N).bin</code> files all stay linked to the source. Extracted files
                    whose names don't share that variant key with the zip will appear as locked "no
                    source" extras and need to be sorted out manually.
                  </p>
                </span>
              </label>
            </div>
            <Show when={editError()}>
              <div class="text-danger">! {editError()}</div>
            </Show>
            <div class="settings-actions">
              <button
                type="button"
                class="tui-button tui-button--save"
                disabled={editSaving() || !editDirty()}
                onClick={saveEdit}
              >
                {editSaving() ? 'SAVING...' : 'SAVE'}
              </button>
              <Show when={editSavedAt() && !editDirty()}>
                <span class="text-green">// SAVED</span>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="tui-panel">
        <div class="tui-titlebar">
          <span>{isOverriding() ? 'OVERRIDE ACTIVE' : 'INHERITING GLOBAL'}</span>
          <span class="text-dim">{isOverriding() ? '// per-mapping' : '// follow global'}</span>
        </div>
        <div class="panel-body">
          <Show when={!loading()} fallback={<div class="text-dim">Loading...</div>}>
            <Show
              when={isOverriding()}
              fallback={
                <>
                  <p class="text-dim" style={{ margin: 0 }}>
                    This mapping inherits the global preferences. Enable an override below to
                    customize the auto-select order just for this mapping.
                  </p>
                  <div>
                    <h3 style={{ margin: '0 0 6px' }}>CURRENT GLOBAL ORDER</h3>
                    <ol class="tui-list">
                      <Show
                        when={globalPrefs().length > 0}
                        fallback={<li class="text-dim">Global preferences list is empty.</li>}
                      >
                        <For each={globalPrefs()}>{(p) => <li>{p}</li>}</For>
                      </Show>
                    </ol>
                  </div>
                </>
              }
            >
              <p class="text-dim" style={{ margin: 0 }}>
                These preferences override the global list for this mapping only. Edit, drag to
                reorder, add new tags, or revert to the global list.
              </p>
              <PreferenceEditor items={items()} onChange={onPrefsChange} disabled={prefSaving()} />
            </Show>

            <Show when={prefError()}>
              <div class="text-danger">! {prefError()}</div>
            </Show>

            <div class="settings-actions">
              <button
                type="button"
                class="tui-button tui-button--save"
                disabled={prefSaving() || !prefDirty()}
                onClick={savePrefs}
              >
                {prefSaving() ? 'SAVING...' : 'SAVE'}
              </button>
              <Show
                when={isOverriding()}
                fallback={
                  <button
                    type="button"
                    class="tui-button"
                    disabled={prefSaving()}
                    onClick={enableOverride}
                  >
                    OVERRIDE FOR THIS MAPPING
                  </button>
                }
              >
                <button
                  type="button"
                  class="tui-button tui-button--amber"
                  disabled={prefSaving()}
                  onClick={inheritGlobal}
                >
                  REVERT TO GLOBAL
                </button>
              </Show>
              <Show when={prefSavedAt() && !prefDirty()}>
                <span class="text-green">// SAVED</span>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
