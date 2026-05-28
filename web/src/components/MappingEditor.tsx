import { Component, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { A } from '@solidjs/router'
import { editor } from '../stores/editor'
import { GameColumn } from './GameColumn'
import { SourceDropdown } from './SourceDropdown'
import { SyncToolbar } from './SyncToolbar'
import { ManualGroupMenu } from './ManualGroupMenu'
import { sourceLabel } from '../lib/paths'

export interface MappingEditorProps {
  id: string
}

export const MappingEditor: Component<MappingEditorProps> = (props) => {
  const [syncing, setSyncing] = createSignal(false)
  const [contextMenu, setContextMenu] = createSignal<{
    filename: string
    x: number
    y: number
  } | null>(null)

  onMount(() => {
    editor.load(props.id)
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    onCleanup(() => window.removeEventListener('click', close))
  })

  const sourceGroups = createMemo(() => editor.sourceGroups())
  const knownPrefixes = createMemo(() => sourceGroups().map((g) => g.prefix))
  const sourcePaths = createMemo(() => editor.state.detail?.mapping.sourcePaths ?? [])

  const onSync = async () => {
    setSyncing(true)
    try {
      await editor.sync()
    } finally {
      setSyncing(false)
    }
  }

  const handleContext = (filename: string, e: MouseEvent) => {
    setContextMenu({ filename, x: e.clientX, y: e.clientY })
  }

  return (
    <Show
      when={!editor.state.loading && editor.state.detail}
      fallback={<div class="text-dim">Loading mapping...</div>}
    >
      <div class="row" style={{ 'margin-bottom': '8px' }}>
        <h2 style={{ margin: 0 }}>{editor.state.detail!.mapping.name}</h2>
        <span class="text-dim" style={{ 'margin-left': 'auto' }}>
          {sourcePaths().length === 1 ? sourcePaths()[0] : `${sourcePaths().length} sources`} →{' '}
          {editor.state.detail!.mapping.destPath}
        </span>
        <A href={`/mapping/${props.id}/settings`} class="crumbs">
          [SETTINGS]
        </A>
      </div>
      <Show when={editor.state.error}>
        <div class="text-danger">! {editor.state.error}</div>
      </Show>

      <div class="tui-grid-2" style={{ flex: 1, 'min-height': 0, overflow: 'hidden' }}>
        <GameColumn
          title="SOURCE //"
          titleMenu={
            <SourceDropdown
              sources={sourcePaths()}
              active={editor.state.activeSource}
              primary={editor.state.detail!.mapping.primarySource}
              onSelect={(p) => editor.setActiveSource(p)}
            />
          }
          side="source"
          groups={sourceGroups()}
          isFileSelected={(f) => editor.isFileSelected(f)}
          onTogglePrefix={(files) => editor.togglePrefix(files)}
          onToggleFile={(filename) => editor.toggleFile(filename)}
          onToggleBundle={(files) => editor.toggleBundle(files)}
          onContextFile={handleContext}
          onToggleAllOn={(groups) => editor.selectAllGroups(groups.map((g) => g.files))}
          onToggleAllOff={(groups) => editor.deselectAllGroups(groups.map((g) => g.files))}
        />
        <GameColumn
          title="DEST // INTENDED"
          side="destination"
          groups={editor.destProjectionGroups()}
          filesToRemove={editor.filesToRemove()}
          extraFiles={editor.extraFiles()}
          // Show which source each synced file comes from when more than
          // one source feeds this destination; redundant with a single source.
          fileSubtext={
            sourcePaths().length > 1
              ? (f) => {
                  const dir = editor.sourceDirFor(f)
                  return dir ? sourceLabel(dir) : undefined
                }
              : undefined
          }
          // Dest-side displays may show alt-ext filenames (e.g. Game.rvz)
          // while state.selected is keyed on source filenames (Game.zip);
          // every interaction goes through destNameToSource so toggles
          // and selection checks read/write the right key.
          isFileSelected={(f) => editor.isFileSelected(editor.destNameToSource(f))}
          onToggleFile={(filename) => editor.toggleFile(editor.destNameToSource(filename))}
          onToggleBundle={(files) => editor.toggleBundle(files.map(editor.destNameToSource))}
          onClearPrefix={(files) => editor.clearFiles(files.map(editor.destNameToSource))}
          onToggleAllOn={(_groups, removals) =>
            editor.restoreFiles(removals.map(editor.destNameToSource))
          }
          onToggleAllOff={(groups) =>
            editor.deselectAllGroups(groups.map((g) => g.files.map(editor.destNameToSource)))
          }
        />
      </div>

      <SyncToolbar
        toCopy={editor.pendingDiff().toCopy}
        toDelete={editor.pendingDiff().toDelete}
        dirty={editor.state.dirty}
        onSync={onSync}
        syncing={syncing()}
      />

      <Show when={contextMenu()}>
        {(cm) => (
          <ManualGroupMenu
            filename={cm().filename}
            x={cm().x}
            y={cm().y}
            prefixes={knownPrefixes()}
            currentGroup={editor.state.manualGroups[cm().filename] ?? null}
            onPick={(target) => editor.setManualGroup(cm().filename, target)}
            onUnmerge={() => editor.setManualGroup(cm().filename, '')}
            onClose={() => setContextMenu(null)}
          />
        )}
      </Show>
    </Show>
  )
}
