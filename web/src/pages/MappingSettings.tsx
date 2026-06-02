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

// Order-sensitive equality — the source list's order is meaningful (it
// drives the dropdown), so reordering counts as a change.
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
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
  const [editSourcePaths, setEditSourcePaths] = createSignal<string[]>([])
  const [editPrimary, setEditPrimary] = createSignal('')
  const [editDestPath, setEditDestPath] = createSignal('')
  const [editAllowedExts, setEditAllowedExts] = createSignal<string[]>([])
  const [editExtractArchives, setEditExtractArchives] = createSignal(false)
  // The source folder currently highlighted in the add-source browser.
  const [candidateSource, setCandidateSource] = createSignal('')
  const [origName, setOrigName] = createSignal('')
  const [origSourcePaths, setOrigSourcePaths] = createSignal<string[]>([])
  const [origPrimary, setOrigPrimary] = createSignal('')
  const [origDestPath, setOrigDestPath] = createSignal('')
  const [origAllowedExts, setOrigAllowedExts] = createSignal<string[]>([])
  const [origExtractArchives, setOrigExtractArchives] = createSignal(false)
  const [editSaving, setEditSaving] = createSignal(false)
  const [editError, setEditError] = createSignal<string | null>(null)
  const [editSavedAt, setEditSavedAt] = createSignal<number | null>(null)

  const editDirty = createMemo(
    () =>
      editName() !== origName() ||
      !arraysEqual(editSourcePaths(), origSourcePaths()) ||
      editPrimary() !== origPrimary() ||
      editDestPath() !== origDestPath() ||
      !setsEqual(editAllowedExts(), origAllowedExts()) ||
      editExtractArchives() !== origExtractArchives(),
  )

  // The effective primary: the explicit selection if still present,
  // otherwise the first source (matching the server's fallback rule).
  const effectivePrimary = createMemo(() => {
    const p = editPrimary()
    const list = editSourcePaths()
    return p && list.includes(p) ? p : (list[0] ?? '')
  })

  const addSource = () => {
    const candidate = candidateSource()
    if (!candidate) return
    setEditSourcePaths((prev) => (prev.includes(candidate) ? prev : [...prev, candidate]))
  }

  const removeSource = (path: string) => {
    setEditSourcePaths((prev) => prev.filter((p) => p !== path))
    if (editPrimary() === path) setEditPrimary('')
  }

  const makePrimary = (path: string) => setEditPrimary(path)

  // Preferences override
  const [globalPrefs, setGlobalPrefs] = createSignal<string[]>([])
  const [override, setOverride] = createSignal<string[] | null>(null)
  const [items, setItems] = createSignal<string[]>([])
  const [prefSaving, setPrefSaving] = createSignal(false)
  const [prefDirty, setPrefDirty] = createSignal(false)
  const [prefError, setPrefError] = createSignal<string | null>(null)
  const [prefSavedAt, setPrefSavedAt] = createSignal<number | null>(null)

  // Low-priority-tags override
  const [globalLowPrio, setGlobalLowPrio] = createSignal<string[]>([])
  const [lowOverride, setLowOverride] = createSignal<string[] | null>(null)
  const [lowItems, setLowItems] = createSignal<string[]>([])
  const [lowSaving, setLowSaving] = createSignal(false)
  const [lowDirty, setLowDirty] = createSignal(false)
  const [lowError, setLowError] = createSignal<string | null>(null)
  const [lowSavedAt, setLowSavedAt] = createSignal<number | null>(null)

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

      setGlobalLowPrio(settings.lowPriorityTags)
      const storedLow = detail.mapping.lowPriorityTags ?? null
      setLowOverride(storedLow)
      setLowItems(storedLow ?? settings.lowPriorityTags)

      setConfig(cfg)
      setEditName(detail.mapping.name)
      const srcPaths = detail.mapping.sourcePaths
      setEditSourcePaths(srcPaths)
      setEditPrimary(detail.mapping.primarySource)
      setEditDestPath(detail.mapping.destPath)
      const exts = detail.mapping.allowedExtensions
      setEditAllowedExts(exts)
      setEditExtractArchives(detail.mapping.extractArchives)
      setOrigName(detail.mapping.name)
      setOrigSourcePaths(srcPaths)
      setOrigPrimary(detail.mapping.primarySource)
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
    if (!editName().trim() || editSourcePaths().length === 0 || !editDestPath()) {
      setEditError('A name, at least one source folder, and a destination are required.')
      return
    }
    setEditSaving(true)
    try {
      const updated = await api.updateMapping(params.id!, {
        name: editName().trim(),
        sourcePaths: editSourcePaths(),
        primarySource: effectivePrimary(),
        destPath: editDestPath(),
        allowedExtensions: editAllowedExts(),
        extractArchives: editExtractArchives(),
      })
      setMappingName(updated.name)
      setOrigName(updated.name)
      setOrigSourcePaths(updated.sourcePaths)
      setOrigPrimary(updated.primarySource)
      setOrigDestPath(updated.destPath)
      setOrigAllowedExts(updated.allowedExtensions)
      setOrigExtractArchives(updated.extractArchives)
      setEditSourcePaths(updated.sourcePaths)
      setEditPrimary(updated.primarySource)
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

  // Low-priority-tags handlers
  const onLowChange = (next: string[]) => {
    setLowItems(next)
    setLowDirty(true)
  }

  const enableLowOverride = () => {
    setLowOverride([...lowItems()])
    setLowDirty(true)
  }

  const inheritLowGlobal = () => {
    setLowOverride(null)
    setLowItems([...globalLowPrio()])
    setLowDirty(true)
  }

  const isLowOverriding = () => lowOverride() !== null

  const saveLow = async () => {
    setLowError(null)
    setLowSaving(true)
    try {
      const payload = isLowOverriding() ? lowItems() : null
      const result = await api.updateMappingLowPriorityTags(params.id!, payload)
      setLowOverride(result.mapping.lowPriorityTags ?? null)
      setLowItems(result.effectiveLowPriorityTags)
      setLowDirty(false)
      setLowSavedAt(Date.now())
    } catch (e) {
      setLowError((e as Error).message)
    } finally {
      setLowSaving(false)
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
                const dstInit = splitPath(editDestPath(), cfg().dests)
                return (
                  <>
                    <div>
                      <h3>SOURCE FOLDERS</h3>
                      <p class="text-dim" style={{ margin: '0 0 8px' }}>
                        One or more read-only source folders feed this destination. The destination
                        is reconciled against all of them; the primary loads first in the editor.
                      </p>
                      <ul class="source-list">
                        <For
                          each={editSourcePaths()}
                          fallback={
                            <li class="text-amber">No source folders — add at least one below.</li>
                          }
                        >
                          {(path) => (
                            <li class="source-list__item">
                              <span class="source-list__path" title={path}>
                                {path}
                              </span>
                              <Show
                                when={effectivePrimary() === path}
                                fallback={
                                  <button
                                    type="button"
                                    class="tui-button"
                                    disabled={editSaving()}
                                    onClick={() => makePrimary(path)}
                                  >
                                    MAKE PRIMARY
                                  </button>
                                }
                              >
                                <span class="source-list__primary">PRIMARY</span>
                              </Show>
                              <button
                                type="button"
                                class="tui-button tui-button--danger"
                                disabled={editSaving() || editSourcePaths().length <= 1}
                                title={
                                  editSourcePaths().length <= 1
                                    ? 'A mapping needs at least one source'
                                    : 'Remove this source'
                                }
                                onClick={() => removeSource(path)}
                              >
                                REMOVE
                              </button>
                            </li>
                          )}
                        </For>
                      </ul>
                      <h3 style={{ 'margin-top': '12px' }}>ADD A SOURCE FOLDER</h3>
                      <FolderBrowser roots={cfg().sources} onSelect={setCandidateSource} />
                      <div class="row" style={{ 'margin-top': '6px', gap: '10px' }}>
                        <button
                          type="button"
                          class="tui-button"
                          disabled={
                            editSaving() ||
                            !candidateSource() ||
                            editSourcePaths().includes(candidateSource())
                          }
                          onClick={addSource}
                        >
                          + ADD SOURCE
                        </button>
                        <span class="text-dim">
                          Selected: <span class="text-green">{candidateSource() || '(none)'}</span>
                        </span>
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
          <span>
            AUTO-SELECT PRIORITY {isOverriding() ? '// OVERRIDE ACTIVE' : '// INHERITING GLOBAL'}
          </span>
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

      <div class="tui-panel" style={{ 'margin-top': '16px' }}>
        <div class="tui-titlebar">
          <span>
            LOW PRIORITY TAGS {isLowOverriding() ? '// OVERRIDE ACTIVE' : '// INHERITING GLOBAL'}
          </span>
          <span class="text-dim">{isLowOverriding() ? '// per-mapping' : '// follow global'}</span>
        </div>
        <div class="panel-body">
          <Show when={!loading()} fallback={<div class="text-dim">Loading...</div>}>
            <Show
              when={isLowOverriding()}
              fallback={
                <>
                  <p class="text-dim" style={{ margin: 0 }}>
                    This mapping inherits the global low-priority tags. A variant carrying any of
                    them is auto-selected only when no cleaner alternative exists. Enable an
                    override below to customize the list just for this mapping.
                  </p>
                  <div>
                    <h3 style={{ margin: '0 0 6px' }}>CURRENT GLOBAL TAGS</h3>
                    <Show
                      when={globalLowPrio().length > 0}
                      fallback={<p class="text-dim">Global low-priority list is empty.</p>}
                    >
                      <div class="tag-input is-disabled" role="list">
                        <For each={globalLowPrio()}>
                          {(t) => (
                            <span class="tag-chip" role="listitem">
                              <span class="tag-chip__text">{t}</span>
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </>
              }
            >
              <p class="text-dim" style={{ margin: 0 }}>
                These low-priority tags override the global list for this mapping only. Order
                doesn't matter; matching is case-insensitive. Leave empty to never demote any
                variant.
              </p>
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
              <Show
                when={isLowOverriding()}
                fallback={
                  <button
                    type="button"
                    class="tui-button"
                    disabled={lowSaving()}
                    onClick={enableLowOverride}
                  >
                    OVERRIDE FOR THIS MAPPING
                  </button>
                }
              >
                <button
                  type="button"
                  class="tui-button tui-button--amber"
                  disabled={lowSaving()}
                  onClick={inheritLowGlobal}
                >
                  REVERT TO GLOBAL
                </button>
              </Show>
              <Show when={lowSavedAt() && !lowDirty()}>
                <span class="text-green">// SAVED</span>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
