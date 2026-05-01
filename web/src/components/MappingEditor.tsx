import { Component, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { A } from "@solidjs/router";
import { editor } from "../stores/editor";
import { GameColumn } from "./GameColumn";
import { SyncToolbar } from "./SyncToolbar";
import { ManualGroupMenu } from "./ManualGroupMenu";

export interface MappingEditorProps {
  id: string;
}

export const MappingEditor: Component<MappingEditorProps> = (props) => {
  const [syncing, setSyncing] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<
    { filename: string; x: number; y: number } | null
  >(null);

  onMount(() => {
    editor.load(props.id);
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    onCleanup(() => window.removeEventListener("click", close));
  });

  const sourceGroups = createMemo(() => editor.state.detail?.sourceGroups ?? []);
  const knownPrefixes = createMemo(() => sourceGroups().map((g) => g.prefix));

  const onSync = async () => {
    setSyncing(true);
    try {
      await editor.sync();
    } finally {
      setSyncing(false);
    }
  };

  const handleContext = (filename: string, e: MouseEvent) => {
    setContextMenu({ filename, x: e.clientX, y: e.clientY });
  };

  return (
    <Show
      when={!editor.state.loading && editor.state.detail}
      fallback={<div class="text-dim">Loading mapping...</div>}
    >
      <div class="row" style={{ "margin-bottom": "8px" }}>
        <h2 style={{ margin: 0 }}>{editor.state.detail!.mapping.name}</h2>
        <span class="text-dim" style={{ "margin-left": "auto" }}>
          {editor.state.detail!.mapping.sourcePath} → {editor.state.detail!.mapping.destPath}
        </span>
        <A href={`/mapping/${props.id}/settings`} class="crumbs">
          [SETTINGS]
        </A>
      </div>
      <Show when={editor.state.error}>
        <div class="text-danger">! {editor.state.error}</div>
      </Show>

      <div class="tui-grid-2">
        <GameColumn
          title="SOURCE // ROMS"
          side="source"
          groups={sourceGroups()}
          isFileSelected={(f) => editor.isFileSelected(f)}
          onTogglePrefix={(files) => editor.togglePrefix(files)}
          onToggleFile={(filename) => editor.toggleFile(filename)}
          onContextFile={handleContext}
        />
        <GameColumn
          title="DEST // INTENDED"
          side="destination"
          groups={editor.destProjectionGroups()}
          filesToRemove={editor.filesToRemove()}
          extraFiles={editor.extraFiles()}
          isFileSelected={(f) => editor.isFileSelected(f)}
          onToggleFile={(filename) => editor.toggleFile(filename)}
          onClearPrefix={(files) => editor.clearFiles(files)}
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
            onUnmerge={() => editor.setManualGroup(cm().filename, "")}
            onClose={() => setContextMenu(null)}
          />
        )}
      </Show>
    </Show>
  );
};
