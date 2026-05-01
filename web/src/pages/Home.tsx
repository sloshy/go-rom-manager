import { Component, Show, createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { mappingsState } from "../stores/mappings";
import { MappingList } from "../components/MappingList";
import { MappingCreator } from "../components/MappingCreator";

export const Home: Component = () => {
  const navigate = useNavigate();
  const [error, setError] = createSignal<string | null>(null);
  const [showCreator, setShowCreator] = createSignal(false);

  onMount(async () => {
    try {
      const list = await mappingsState.refresh();
      if (list.length === 0) setShowCreator(true);
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Show when={error()}>
        <div class="text-danger">! {error()}</div>
      </Show>
      <Show when={(mappingsState.list() ?? []).length > 0}>
        <MappingList
          mappings={mappingsState.list() ?? []}
          onOpen={(id) => navigate(`/mapping/${id}`)}
          onDelete={async (id) => {
            await mappingsState.remove(id);
          }}
        />
        <div>
          <button class="tui-button" onClick={() => setShowCreator((s) => !s)}>
            {showCreator() ? "CANCEL NEW" : "+ NEW MAPPING"}
          </button>
        </div>
      </Show>
      <Show when={showCreator()}>
        <MappingCreator
          onCreated={async (id) => {
            await mappingsState.refresh();
            navigate(`/mapping/${id}`);
          }}
        />
      </Show>
    </div>
  );
};
