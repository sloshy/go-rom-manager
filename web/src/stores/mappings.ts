import { createSignal } from "solid-js";
import { api, type Mapping } from "../api/client";

const [mappings, setMappings] = createSignal<Mapping[] | null>(null);

export const mappingsState = {
  list: mappings,

  async refresh() {
    const data = await api.listMappings();
    setMappings(data.mappings ?? []);
    return data.mappings ?? [];
  },

  async create(input: { name: string; sourcePath: string; destPath: string }) {
    const created = await api.createMapping(input);
    setMappings((prev) => [...(prev ?? []), created]);
    return created;
  },

  async remove(id: string) {
    await api.deleteMapping(id);
    setMappings((prev) => (prev ?? []).filter((m) => m.id !== id));
  },
};
