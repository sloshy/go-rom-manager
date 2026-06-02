/**
 * Thin fetch wrappers around the Go API. Every function throws on a
 * non-2xx response with the server's error message included.
 */

export interface AppConfigPayload {
  sources: string[]
  dests: string[]
}

export interface BrowseEntry {
  name: string
  isDir: boolean
}

export interface BrowsePayload {
  path: string
  entries: BrowseEntry[]
}

export interface Mapping {
  id: string
  name: string
  /** Ordered list of read-only source folders feeding the destination. */
  sourcePaths: string[]
  /**
   * Source folder the editor loads first. Empty means "use the first
   * entry of sourcePaths". Always one of sourcePaths when set.
   */
  primarySource: string
  destPath: string
  manualGroups: Record<string, string>
  /** Per-mapping preference override; absent/null means inherit global. */
  preferences?: string[] | null
  /**
   * Per-mapping low-priority-tags override; absent/null means inherit the
   * global list. A present array (even empty, meaning "demote nothing") is
   * an explicit override.
   */
  lowPriorityTags?: string[] | null
  /**
   * Dest-side alt-format extensions (e.g. ".rvz") considered equivalent
   * to a source file with the same basename. Always normalized to
   * lowercase ".ext" form by the server and always serialized as an
   * array (possibly empty).
   */
  allowedExtensions: string[]
  /**
   * When true, .zip source files are extracted into the destination on
   * sync (with inner entries renamed to share the zip's stem) instead
   * of being copied verbatim. Inner extensions still need to appear in
   * `allowedExtensions` for the resulting files to round-trip.
   */
  extractArchives: boolean
}

/** One configured source folder's contents, as returned with a mapping. */
export interface SourceView {
  path: string
  files: string[]
  groups: { prefix: string; files: string[] }[]
}

export interface MappingDetail {
  mapping: Mapping
  /** Per-source contents, in configured order. */
  sources: SourceView[]
  destFiles: string[]
  /** Resolved preference list — the per-mapping override if set, otherwise the global. */
  effectivePreferences: string[]
  /** Resolved low-priority-tags list — per-mapping override if set, otherwise the global/default. */
  effectiveLowPriorityTags: string[]
}

export interface SyncResult {
  copied: string[]
  deleted: string[]
}

/** One intended file plus the source directory it should be copied from. */
export interface IntendedFile {
  name: string
  dir: string
}

export interface SettingsPayload {
  preferences: string[]
  defaultPreferences: string[]
  lowPriorityTags: string[]
  defaultLowPriorityTags: string[]
}

/** Partial global-settings update — each field is updated only if present. */
export interface UpdateSettingsBody {
  preferences?: string[]
  lowPriorityTags?: string[]
}

export interface MappingPreferencesPayload {
  mapping: Mapping
  effectivePreferences: string[]
}

export interface MappingLowPriorityPayload {
  mapping: Mapping
  effectiveLowPriorityTags: string[]
}

export interface UpdateMappingBody {
  name: string
  sourcePaths: string[]
  primarySource: string
  destPath: string
  allowedExtensions: string[]
  extractArchives: boolean
}

/** A single dependency's attribution metadata + license text. */
export interface LicenseEntry {
  name: string
  version: string
  license: string
  text: string
}

/** Two-bucket attribution manifest, keyed by language. */
export interface LicenseManifest {
  go: LicenseEntry[]
  js: LicenseEntry[]
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body && typeof body === 'object' && 'error' in body) msg = body.error as string
    } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  getConfig: () => jsonFetch<AppConfigPayload>('/api/config'),

  browse: (root: string, sub = '') => {
    const params = new URLSearchParams({ root, sub })
    return jsonFetch<BrowsePayload>(`/api/browse?${params.toString()}`)
  },

  listMappings: () => jsonFetch<{ mappings: Mapping[] }>('/api/mappings'),

  createMapping: (body: { name: string; sourcePath: string; destPath: string }) =>
    jsonFetch<Mapping>('/api/mappings', { method: 'POST', body: JSON.stringify(body) }),

  getMapping: (id: string) => jsonFetch<MappingDetail>(`/api/mappings/${id}`),

  updateMapping: (id: string, body: UpdateMappingBody) =>
    jsonFetch<Mapping>(`/api/mappings/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteMapping: (id: string) => jsonFetch<void>(`/api/mappings/${id}`, { method: 'DELETE' }),

  sync: (id: string, body: { intended: IntendedFile[]; manualGroups: Record<string, string> }) =>
    jsonFetch<SyncResult>(`/api/mappings/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSettings: () => jsonFetch<SettingsPayload>('/api/settings'),

  /**
   * Update one or more global settings lists. Omitted fields are left
   * unchanged server-side, so each settings panel can save independently.
   * Returns the full resolved settings.
   */
  updateSettings: (body: UpdateSettingsBody) =>
    jsonFetch<SettingsPayload>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /**
   * Replace a mapping's preference override. Pass null to clear the
   * override and inherit the global preferences again.
   */
  updateMappingPreferences: (id: string, preferences: string[] | null) =>
    jsonFetch<MappingPreferencesPayload>(`/api/mappings/${id}/preferences`, {
      method: 'PUT',
      body: JSON.stringify({ preferences }),
    }),

  /**
   * Replace a mapping's low-priority-tags override. Pass null to clear the
   * override and inherit the global list again.
   */
  updateMappingLowPriorityTags: (id: string, lowPriorityTags: string[] | null) =>
    jsonFetch<MappingLowPriorityPayload>(`/api/mappings/${id}/low-priority-tags`, {
      method: 'PUT',
      body: JSON.stringify({ lowPriorityTags }),
    }),

  getLicenses: () => jsonFetch<LicenseManifest>('/api/licenses'),
}
