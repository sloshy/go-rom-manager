import { Component, Show, createResource, createSignal } from 'solid-js'
import { api } from '../api/client'
import { FolderBrowser } from './FolderBrowser'

export interface MappingCreatorProps {
  onCreated: (id: string) => void
}

export const MappingCreator: Component<MappingCreatorProps> = (props) => {
  const [config] = createResource(() => api.getConfig())
  const [name, setName] = createSignal('')
  const [sourcePath, setSourcePath] = createSignal('')
  const [destPath, setDestPath] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [submitting, setSubmitting] = createSignal(false)

  const submit = async () => {
    setError(null)
    if (!name().trim() || !sourcePath() || !destPath()) {
      setError('All fields required.')
      return
    }
    setSubmitting(true)
    try {
      const created = await api.createMapping({
        name: name().trim(),
        sourcePath: sourcePath(),
        destPath: destPath(),
      })
      props.onCreated(created.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class="tui-panel">
      <div class="tui-titlebar">
        <span>NEW MAPPING</span>
      </div>
      <div style={{ padding: '16px', display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
        <div>
          <label class="text-dim">NAME &gt;</label>
          <input
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            style={{ width: '100%', 'margin-top': '4px' }}
            placeholder="e.g. SNES, Genesis, GBA..."
          />
        </div>
        <Show when={config()}>
          {(cfg) => (
            <>
              <div>
                <h3>SOURCE FOLDER</h3>
                <FolderBrowser roots={cfg().sources} onSelect={setSourcePath} />
                <div class="text-dim" style={{ 'margin-top': '4px' }}>
                  Selected: <span class="text-green">{sourcePath() || '(none)'}</span>
                </div>
              </div>
              <div>
                <h3>DESTINATION FOLDER</h3>
                <FolderBrowser roots={cfg().dests} onSelect={setDestPath} />
                <div class="text-dim" style={{ 'margin-top': '4px' }}>
                  Selected: <span class="text-amber">{destPath() || '(none)'}</span>
                </div>
              </div>
            </>
          )}
        </Show>
        <Show when={error()}>
          <div class="text-danger">! {error()}</div>
        </Show>
        <div>
          <button class="tui-button" disabled={submitting()} onClick={submit}>
            {submitting() ? 'CREATING...' : 'CREATE MAPPING'}
          </button>
        </div>
      </div>
    </div>
  )
}
