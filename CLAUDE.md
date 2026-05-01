# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & test

The Go binary embeds the SolidJS bundle from `web/dist`, so the frontend must be built before the Go binary can serve a useful UI.

```bash
./scripts/bundle.sh                # full pipeline: web npm ci → typecheck → vitest → vite build → go test → go build
./scripts/bundle.sh --skip-tests   # faster iteration (still rebuilds web/dist + binary)

go test ./...                      # backend only
go test -race ./internal/fsutil    # one package
go test ./internal/games -run TestAutoSelect   # one test

cd web && npm test                 # frontend (vitest run)
cd web && npm run test:watch       # vitest watch
cd web && npm run typecheck        # tsc --noEmit
cd web && npm run dev              # vite dev server on 5173, proxies /api → :8080
```

For frontend-only iteration: run `./rom-manager --source ... --dest ...` on `:8080`, then `npm run dev` in `web/` — vite proxies `/api` to the Go server, so you get HMR for the SPA without rebuilding the binary.

CI matrix is Go 1.26 / Node 24 (see `.github/workflows/test.yml`); `go.mod` declares `go 1.26.2`.

## Running

`./rom-manager --source <dir> --dest <dir> [--source ...] [--dest ...] [--addr :8080] [--config path/to/mappings.json]`

Both `--source` and `--dest` are repeatable and must be existing directories — `config.AppConfig.Validate` absolutizes them and rejects anything that isn't a directory at startup. Default config path is `$XDG_CONFIG_HOME/go-rom-manager/mappings.json`. Docker image runs as `nonroot`, persists to `/data/mappings.json`.

## Architecture

### The mental model the code is built around

Sources are read-only ROM directories. Destinations receive copies. A **mapping** pairs one source folder with one destination folder. Inside a mapping, files are partitioned into **games** by parsing `Prefix (Tags) (More Tags).ext`: everything before the first `(` is the prefix, parenthesised groups are tags. Files sharing a prefix form a group; the user picks which variant(s) of each group should appear in the destination.

The destination is **only** mutated by sync, and only for files the mapping previously owned (see "managed files" below). Sources are never written.

### Backend layout (`internal/`)

- **`games/`** — pure functions, no I/O. `ParseName` splits filename → prefix+tags. `GroupFiles` buckets files by prefix, honouring a `manualGroups` map (filename → override-prefix) for cases like merging a Japanese release into the same group as its Western counterpart. `AutoSelectWith(files, preferences)` picks the best variant of a group: drop `Demo`/`Proto` if any others exist → walk `preferences` top-to-bottom, first matching tag wins → break ties by highest `Rev N`. `AutoSelect(files)` is a thin wrapper using `DefaultPreferences = ["USA", "World"]`. The frontend mirrors this logic in `web/src/lib/games.ts`; **keep the two implementations in sync** when changing selection rules. Demo/Proto exclusion and the Rev tiebreaker are fixed; only the priority list is user-configurable.
- **`fsutil/`** — filesystem operations. `EnsureUnderRoot` is the single chokepoint that prevents path traversal; every user-supplied path goes through it before any read/write. `ComputeSync` produces a `SyncPlan{ToCopy, ToDelete}`; `ExecuteSync` applies it (atomic copy via temp+rename, delete leftovers). `Browse`/`ListFiles` are sorted dirs-first / case-insensitive.
- **`config/`** — `AppConfig` is the validated CLI args. `Store` is a mutex-guarded JSON file of `Mapping{ID, Name, SourcePath, DestPath, ManualGroups, Preferences}` plus a top-level `globalPreferences`. All writes are temp+rename. `Mapping.Preferences` is `*[]string`: `nil` means "inherit the global list"; a non-nil slice (even empty) is an explicit override. `globalPreferences` itself is `*[]string` so an unset field falls back to `games.DefaultPreferences`. **Note**: there is intentionally no `Selections` field — the set of "selected" files is derived from disk at runtime, not persisted. Legacy `selections` keys in older mappings.json files are silently dropped on the next save (`encoding/json` ignores unknown fields by default).
- **`server/`** — `http.ServeMux` with method-pattern routes (Go 1.22+ syntax, e.g. `GET /api/mappings/{id}`). `spaFileServer` serves the embedded `web/dist`, falling through to `index.html` for unknown paths so client-side routes resolve. **`/api/*` paths never fall through to the SPA** — they 404 explicitly. `effectivePreferences` (per-mapping override → global → default) is resolved server-side and returned with each `GET /api/mappings/{id}` so the frontend never has to merge them. `cleanPreferences` trims/drops blanks and rejects case-insensitive duplicates on every settings or per-mapping PUT.

### The sync model (everything derives from disk)

There is no persisted "what's selected" state — the editor reconstructs it on every load. The flow:

1. Editor loads `/api/mappings/{id}` → server returns `sourceFiles`, `destFiles`, `sourceGroups`, and the mapping's `manualGroups`.
2. Frontend derives the initial selected set as **`destFiles ∩ sourceFiles`**: a file is "selected" iff a same-named file exists in both source and dest.
3. Files in `destFiles` with no source counterpart are the **orange extras** — they have nowhere to come from, so the mapping cannot manage them. The UI renders them disabled.
4. User edits stage purely in the in-memory `editor.ts` store (`selected: Record<filename, true>`, `manualGroups`).
5. POST `/api/mappings/{id}/sync` sends `{ intended: string[], manualGroups }`. Server computes `ComputeSync(intended, sourceFiles, destDir)`:
   - **Copy**: anything in `intended` missing from dest.
   - **Delete**: anything in dest that's *not* in `intended` **and** *has* a source counterpart. No-source-counterpart files are never deleted — that's how orange survives.
6. Server persists `manualGroups` (the only user-authored intent that can't be re-derived) and executes the plan. Next reload re-derives selected from the now-updated dest.

If you touch the sync logic, preserve two contracts: (a) orange files must survive — anything in dest with no `sourceFiles` entry is untouchable; (b) "selected" is never persisted server-side. There is no source of truth other than the filesystem (plus user-authored manualGroups).

### Frontend (`web/src/`)

SolidJS + `@solidjs/router`. State lives in two stores:

- **`stores/mappings.ts`** — list of mappings, hydrated from `/api/mappings`.
- **`stores/editor.ts`** — single mapping being edited. On `load()` the initial `selected: Record<filename, true>` set is derived from `destFiles ∩ sourceFiles`; `manualGroups` rehydrates from the persisted mapping. Both stage in memory until `sync()`; `dirty` tracks whether anything changed. The store exposes derived memos for what the destination *will* look like (`destProjectionGroups`), what's queued for deletion (`filesToRemove` = deselected dest files with a source counterpart), what's untouched (`extraFiles` = dest files with no source counterpart), and pending op counts (`pendingDiff`). UI colour coding (green/red/orange) flows from these memos. `togglePrefix` calls `autoSelect(files, detail.effectivePreferences)` — the editor never resolves override-vs-global itself.

`api/client.ts` — every endpoint goes through `jsonFetch`, which throws `Error(body.error)` on non-2xx so components can `catch` and display.

Routes (`App.tsx`): `/` Home, `/mapping/:id` editor, `/settings` global preferences, `/mapping/:id/settings` per-mapping override (or "inheriting" preview when no override is set). Both settings pages share `components/PreferenceEditor.tsx`, a controlled drag-and-drop list — the parent owns the array, the parent renders the green save button (`tui-button--save`).

Frontend tests use Vitest + jsdom + `@solidjs/testing-library`.

## Conventions worth knowing

- **Containment-checked paths everywhere.** Anything that arrives from an HTTP request and gets turned into a filesystem path passes through `fsutil.EnsureUnderRoot` against either `cfg.Sources` or `cfg.Dests`. Adding a new endpoint that takes a path? Run it through `EnsureUnderRoot`.
- **`go:embed all:web/dist`** — production builds need `web/dist/` populated before `go build`. CI and `bundle.sh` enforce this; if you `go build` directly without a prior `npm run build`, the SPA will be empty.
- **Atomic writes**: both the mappings JSON store and the sync copy use temp file + `os.Rename` to avoid partial writes mid-failure.
- **Releases**: pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds a multi-arch image to `ghcr.io/<owner>/<repo>` and attaches per-OS/per-arch binaries to the GitHub release.
