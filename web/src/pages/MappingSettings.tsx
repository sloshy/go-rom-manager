import { Component, Show, createSignal, onMount } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { api } from "../api/client";
import { PreferenceEditor } from "../components/PreferenceEditor";

export const MappingSettings: Component = () => {
  const params = useParams<{ id: string }>();
  const [mappingName, setMappingName] = createSignal<string>("");
  const [globalPrefs, setGlobalPrefs] = createSignal<string[]>([]);
  const [override, setOverride] = createSignal<string[] | null>(null);
  const [items, setItems] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);

  onMount(async () => {
    try {
      const [detail, settings] = await Promise.all([
        api.getMapping(params.id!),
        api.getSettings(),
      ]);
      setMappingName(detail.mapping.name);
      setGlobalPrefs(settings.preferences);
      const stored = detail.mapping.preferences ?? null;
      setOverride(stored);
      setItems(stored ?? settings.preferences);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  });

  const onChange = (next: string[]) => {
    setItems(next);
    setDirty(true);
  };

  const enableOverride = () => {
    // Seed the override with the current effective list as a starting point.
    setOverride([...items()]);
    setDirty(true);
  };

  const inheritGlobal = () => {
    setOverride(null);
    setItems([...globalPrefs()]);
    setDirty(true);
  };

  const isOverriding = () => override() !== null;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = isOverriding() ? items() : null;
      const result = await api.updateMappingPreferences(params.id!, payload);
      setOverride(result.mapping.preferences ?? null);
      setItems(result.effectivePreferences);
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="settings-page">
      <div class="row" style={{ "margin-bottom": "8px" }}>
        <h2 style={{ margin: 0 }}>MAPPING PREFERENCES</h2>
        <Show when={mappingName()}>
          <span class="text-dim" style={{ "margin-left": "12px" }}>// {mappingName()}</span>
        </Show>
        <A href={`/mapping/${params.id}`} class="crumbs" style={{ "margin-left": "auto" }}>
          [BACK]
        </A>
      </div>

      <div class="tui-panel">
        <div class="tui-titlebar">
          <span>{isOverriding() ? "OVERRIDE ACTIVE" : "INHERITING GLOBAL"}</span>
          <span class="text-dim">{isOverriding() ? "// per-mapping" : "// follow global"}</span>
        </div>
        <div class="panel-body">
          <Show
            when={!loading()}
            fallback={<div class="text-dim">Loading...</div>}
          >
            <Show
              when={isOverriding()}
              fallback={
                <>
                  <p class="text-dim" style={{ margin: 0 }}>
                    This mapping inherits the global preferences. Enable an
                    override below to customize the auto-select order just for
                    this mapping.
                  </p>
                  <div>
                    <h3 style={{ margin: "0 0 6px" }}>CURRENT GLOBAL ORDER</h3>
                    <ol class="tui-list">
                      <Show
                        when={globalPrefs().length > 0}
                        fallback={
                          <li class="text-dim">
                            Global preferences list is empty.
                          </li>
                        }
                      >
                        {globalPrefs().map((p) => (
                          <li>{p}</li>
                        ))}
                      </Show>
                    </ol>
                  </div>
                </>
              }
            >
              <p class="text-dim" style={{ margin: 0 }}>
                These preferences override the global list for this mapping
                only. Edit, drag to reorder, add new tags, or revert to the
                global list.
              </p>
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
                {saving() ? "SAVING..." : "SAVE"}
              </button>
              <Show
                when={isOverriding()}
                fallback={
                  <button type="button" class="tui-button" disabled={saving()} onClick={enableOverride}>
                    OVERRIDE FOR THIS MAPPING
                  </button>
                }
              >
                <button
                  type="button"
                  class="tui-button tui-button--amber"
                  disabled={saving()}
                  onClick={inheritGlobal}
                >
                  REVERT TO GLOBAL
                </button>
              </Show>
              <Show when={savedAt() && !dirty()}>
                <span class="text-green">// SAVED</span>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
