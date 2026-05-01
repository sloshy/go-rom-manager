/**
 * Thin fetch wrappers around the Go API. Every function throws on a
 * non-2xx response with the server's error message included.
 */

export interface AppConfigPayload {
  sources: string[];
  dests: string[];
}

export interface BrowseEntry {
  name: string;
  isDir: boolean;
}

export interface BrowsePayload {
  path: string;
  entries: BrowseEntry[];
}

export interface Mapping {
  id: string;
  name: string;
  sourcePath: string;
  destPath: string;
  manualGroups: Record<string, string>;
  /** Per-mapping preference override; absent/null means inherit global. */
  preferences?: string[] | null;
}

export interface MappingDetail {
  mapping: Mapping;
  sourceFiles: string[];
  destFiles: string[];
  sourceGroups: { prefix: string; files: string[] }[];
  /** Resolved preference list — the per-mapping override if set, otherwise the global. */
  effectivePreferences: string[];
}

export interface SyncResult {
  copied: string[];
  deleted: string[];
}

export interface SettingsPayload {
  preferences: string[];
  defaultPreferences: string[];
}

export interface MappingPreferencesPayload {
  mapping: Mapping;
  effectivePreferences: string[];
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body === "object" && "error" in body) msg = body.error as string;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  getConfig: () => jsonFetch<AppConfigPayload>("/api/config"),

  browse: (root: string, sub = "") => {
    const params = new URLSearchParams({ root, sub });
    return jsonFetch<BrowsePayload>(`/api/browse?${params.toString()}`);
  },

  listMappings: () => jsonFetch<{ mappings: Mapping[] }>("/api/mappings"),

  createMapping: (body: { name: string; sourcePath: string; destPath: string }) =>
    jsonFetch<Mapping>("/api/mappings", { method: "POST", body: JSON.stringify(body) }),

  getMapping: (id: string) => jsonFetch<MappingDetail>(`/api/mappings/${id}`),

  deleteMapping: (id: string) =>
    jsonFetch<void>(`/api/mappings/${id}`, { method: "DELETE" }),

  sync: (
    id: string,
    body: { intended: string[]; manualGroups: Record<string, string> },
  ) =>
    jsonFetch<SyncResult>(`/api/mappings/${id}/sync`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getSettings: () => jsonFetch<SettingsPayload>("/api/settings"),

  updateSettings: (preferences: string[]) =>
    jsonFetch<{ preferences: string[] }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ preferences }),
    }),

  /**
   * Replace a mapping's preference override. Pass null to clear the
   * override and inherit the global preferences again.
   */
  updateMappingPreferences: (id: string, preferences: string[] | null) =>
    jsonFetch<MappingPreferencesPayload>(`/api/mappings/${id}/preferences`, {
      method: "PUT",
      body: JSON.stringify({ preferences }),
    }),
};
