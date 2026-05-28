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

`--licenses` prints all bundled dependencies grouped by Go vs JavaScript and exits; `--license <name>` prints the full license text for one dep (case-insensitive exact match, error on no match). Both flags read from the embedded manifest at `internal/licenses/manifest.json` so they work offline.

## Dependency licenses

`cmd/gen-licenses/main.go` walks Go modules (`go list -m -json all`) and the production npm tree (`npm ls --omit=dev --all --json` from `web/`), reads each module's LICENSE file (plus the project's own LICENSE and the Go runtime LICENSE from `$GOROOT`), and writes `internal/licenses/manifest.json`. The manifest is `//go:embed`-ed by `internal/licenses/licenses.go` and surfaced via three channels: the `--licenses`/`--license` CLI flags, `GET /api/licenses`, and the `/licenses` SPA route (`web/src/pages/Licenses.tsx`). `bundle.sh` regenerates the manifest after `vite build` and before `go test`/`go build`, so it stays in sync with whatever `npm ci` resolved. The committed manifest is just a fallback for fresh checkouts that haven't run the pipeline yet.

## Architecture

### The mental model the code is built around

Sources are read-only ROM directories. Destinations receive copies. A **mapping** pairs one or more source folders with one destination folder. The destination is reconciled against the **union** of all the mapping's sources; the source column shows one source at a time (switchable via a dropdown in its title bar), with an optional "primary" source that loads first. Filenames are expected to be unique across the union — selection is keyed by filename, so a given name can be selected from exactly one source at a time. Inside a mapping, files are partitioned into **games** by parsing `Prefix (Tags) (More Tags).ext`: everything before the first `(` is the prefix, parenthesised groups are tags. Files sharing a prefix form a group; the user picks which variant(s) of each group should appear in the destination.

The destination is **only** mutated by sync, and only for files the mapping previously owned (see "managed files" below). Sources are never written.

### Backend layout (`internal/`)

- **`games/`** — pure functions, no I/O. `ParseName` splits filename → prefix+tags. `GroupFiles` buckets files by prefix, honouring a `manualGroups` map (filename → override-prefix) for cases like merging a Japanese release into the same group as its Western counterpart. `AutoSelectWith(files, preferences)` picks the best variant of a group: drop `Demo`/`Proto` if any others exist → walk `preferences` top-to-bottom, first matching tag wins → break ties by highest `Rev N`. `AutoSelect(files)` is a thin wrapper using `DefaultPreferences = ["USA", "World"]`. The frontend mirrors this logic in `web/src/lib/games.ts`; **keep the two implementations in sync** when changing selection rules. Demo/Proto exclusion and the Rev tiebreaker are fixed; only the priority list is user-configurable.
- **`fsutil/`** — filesystem operations. `EnsureUnderRoot` is the single chokepoint that prevents path traversal; every user-supplied path goes through it before any read/write. `ComputeSync(intended, sourceFiles, destDir, allowedExts)` produces a `SyncPlan{ToCopy, ToDelete}`, where `intended` and `ToCopy` are `[]SourceFile{Name, Dir}` — each file carries the source directory it came from, so a multi-source mapping copies each file from the right place; `sourceFiles` is the union of every source's basenames (the deletion "managed" oracle). `ExecuteSync(destDir, plan, extractArchives)` applies it, copying each `ToCopy` entry from its own `Dir` (atomic copy via temp+rename, delete leftovers; with `extractArchives=true`, ToCopy entries with `.zip` extension are extracted via `ExtractZip` instead of copied verbatim). `allowedExts` lets a dest file match a source file by `games.VariantKey` when its extension is on the list — see "alt-extension matching" below. `Browse`/`ListFiles` are sorted dirs-first / case-insensitive.
- **`config/`** — `AppConfig` is the validated CLI args. `Store` is a mutex-guarded JSON file of `Mapping{ID, Name, SourcePaths, PrimarySource, DestPath, ManualGroups, Preferences, AllowedExtensions, ExtractArchives}` plus a top-level `globalPreferences`. All writes are temp+rename. `Mapping.SourcePaths` is the ordered list of source folders feeding the destination; `PrimarySource` (omitted when empty) names the one that loads first, else the first entry is used. The legacy single `sourcePath` field is migrated into `SourcePaths` on load and cleared (so it never round-trips). `Mapping.Preferences` is `*[]string`: `nil` means "inherit the global list"; a non-nil slice (even empty) is an explicit override. `globalPreferences` itself is `*[]string` so an unset field falls back to `games.DefaultPreferences`. `Mapping.AllowedExtensions` is a normalized list of lowercase ".ext" entries; empty means strict-name matching. **Note**: there is intentionally no `Selections` field — the set of "selected" files is derived from disk at runtime, not persisted. Legacy `selections` keys in older mappings.json files are silently dropped on the next save (`encoding/json` ignores unknown fields by default).
- **`server/`** — `http.ServeMux` with method-pattern routes (Go 1.22+ syntax, e.g. `GET /api/mappings/{id}`). `spaFileServer` serves the embedded `web/dist`, falling through to `index.html` for unknown paths so client-side routes resolve. **`/api/*` paths never fall through to the SPA** — they 404 explicitly. `GET /api/mappings/{id}` returns a per-source `sources: [{path, files, groups}]` array (configured order) plus `destFiles` and `effectivePreferences`. `effectivePreferences` (per-mapping override → global → default) is resolved server-side so the frontend never has to merge them. `cleanPreferences` trims/drops blanks and rejects case-insensitive duplicates on every settings or per-mapping PUT. `cleanSourcePaths` (on `PUT /api/mappings/{id}`) trims/dedupes the source list, requires ≥1, and runs each through `EnsureUnderRoot`; `resolvePrimarySource` validates the optional primary is one of them. `cleanExtensions` normalizes `allowedExtensions` to lowercase ".ext" form and silently dedupes. `POST /api/mappings/{id}/sync` takes `intended: [{name, dir}]`; each `dir` is validated to be one of the mapping's configured sources (both to fix the copy origin and to refuse copies from arbitrary directories).

### The sync model (everything derives from disk)

There is no persisted "what's selected" state — the editor reconstructs it on every load. The flow:

1. Editor loads `/api/mappings/{id}` → server returns `sources` (per-source `{path, files, groups}` in configured order), `destFiles`, and the mapping's `manualGroups` + `allowedExtensions` + `primarySource`.
2. Frontend derives the initial selected set as **`destFiles ∩ union(sources)`** (with alt-ext matching, see below): a source file is "selected" iff dest contains either (a) the same filename or (b) a file with the same `variantKey` (prefix + non-track tags) and an extension in `allowedExtensions`. Each selected file is tagged with the source directory that owns it (first source, in primary-first order, that contains the name).
3. Files in `destFiles` with no source counterpart (by exact name AND by alt-ext variant-key match) anywhere in the union are the **orange extras** — they have nowhere to come from, so the mapping cannot manage them. The UI renders them disabled.
4. User edits stage purely in the in-memory `editor.ts` store (`selected: Record<filename, sourceDir>`, `activeSource`, `manualGroups`). The source column shows `activeSource`; toggling a file attributes it to the active source (or its owner when toggled from the dest side).
5. POST `/api/mappings/{id}/sync` sends `{ intended: [{name, dir}], manualGroups }`. Server computes `ComputeSync(intended, unionSourceFiles, destDir, m.AllowedExtensions)`:
   - **Copy**: anything in `intended` missing from dest *and* not already represented by an alt-ext file in dest with the same `VariantKey` — copied from its own `dir`.
   - **Delete**: anything in dest that's not satisfying any intent (exact or alt-ext) **and** is "managed" — i.e. has a counterpart in the union by exact name, or has an extension in `allowedExtensions` and shares a `VariantKey` with a union source file. No-source-counterpart files are never deleted — that's how orange survives.
6. Server persists `manualGroups` (the only user-authored intent that can't be re-derived) and executes the plan. Next reload re-derives selected from the now-updated dest.

If you touch the sync logic, preserve two contracts: (a) orange files must survive — anything in dest with no source counterpart (exact or alt-ext) is untouchable; (b) "selected" is never persisted server-side. There is no source of truth other than the filesystem (plus user-authored manualGroups + allowedExtensions).

**Alt-extension matching.** When `allowedExtensions` is non-empty, sync treats `Game.rvz` in dest as the same file as `Game.zip` in source if `.rvz` is on the list — useful when an external tool converts ROMs to a different on-disk format. Match key: same `games.VariantKey` (parsed prefix + tags with `(Track N)` and `(Side X)` markers stripped) AND dest extension is in the (lowercase, leading-dot) allowed list. Source extensions are not constrained. Variant-key matching (rather than plain stem) is what lets a single source `Game.zip` claim the entire post-extract bundle — `Game.cue` plus `Game (Track N).bin` files all share the variant key `Game`, so the bins trace back to the zip and don't show up as orange extras. The frontend mirrors this in `web/src/lib/games.ts` (`variantKey`, `isAllowedExt`) and `web/src/stores/editor.ts` (every memo: `deriveInitialSelected`, `extraFiles`, `filesToRemove`, `pendingDiff`, plus `detailDerived`'s source/dest variant maps); **keep frontend and backend in sync** when changing the matching rule. The variant-part regex (`^(?:Track\s+\d+|Side\s+[A-Z])$`, case-insensitive) lives in both `internal/games/parse.go` and `web/src/lib/games.ts` — change them together.

### Frontend (`web/src/`)

SolidJS + `@solidjs/router`. State lives in two stores:

- **`stores/mappings.ts`** — list of mappings, hydrated from `/api/mappings`.
- **`stores/editor.ts`** — single mapping being edited. On `load()` the initial `selected: Record<filename, sourceDir>` set is derived from `destFiles ∩ union(sources)` (exact filenames, plus alt-ext variant-key matches when `allowedExtensions` is set), each tagged with its owning source; `activeSource` starts at the primary (or first source) and `setActiveSource` switches which source the column shows; `manualGroups` rehydrates from the persisted mapping. All stage in memory until `sync()`; `dirty` tracks whether anything changed. Selection-set derivations (`detailDerived`, `destProjectionGroups`, `filesToRemove`, `extraFiles`, `pendingDiff`) work over the union of all sources. `sourceDirFor(destName)` reports which source feeds a projected dest file (rendered as the green per-file "from <source>" subtext). UI colour coding (green/red/orange) flows from these memos. `togglePrefix` calls `autoSelectVariant(files, detail.effectivePreferences)` so multi-track variants toggle as a unit — the editor never resolves override-vs-global itself.

`api/client.ts` — every endpoint goes through `jsonFetch`, which throws `Error(body.error)` on non-2xx so components can `catch` and display.

Routes (`App.tsx`): `/` Home, `/mapping/:id` editor, `/settings` global preferences, `/mapping/:id/settings` per-mapping override (or "inheriting" preview when no override is set) plus the EDIT MAPPING panel (name + the multi-source manager — add/remove sources, mark one primary — + destination + `allowedExtensions`). The editor's source column title bar hosts the `SourceDropdown` switcher; `lib/paths.ts#sourceLabel` gives the short per-source display label used there and in the dest subtext. Both settings pages share `components/PreferenceEditor.tsx`, a controlled drag-and-drop list — the parent owns the array, the parent renders the green save button (`tui-button--save`). `components/TagInput.tsx` is the comma-commits / X-removes chip editor used for `allowedExtensions`; it accepts an optional `normalize` callback (e.g. lowercase + ensure leading dot) and silently dedupes.

Frontend tests use Vitest + jsdom + `@solidjs/testing-library`.

## Conventions worth knowing

- **Containment-checked paths everywhere.** Anything that arrives from an HTTP request and gets turned into a filesystem path passes through `fsutil.EnsureUnderRoot` against either `cfg.Sources` or `cfg.Dests`. Adding a new endpoint that takes a path? Run it through `EnsureUnderRoot`.
- **`go:embed all:web/dist`** — production builds need `web/dist/` populated before `go build`. CI and `bundle.sh` enforce this; if you `go build` directly without a prior `npm run build`, the SPA will be empty.
- **Atomic writes**: both the mappings JSON store and the sync copy use temp file + `os.Rename` to avoid partial writes mid-failure.
- **Releases**: pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds a multi-arch image to `ghcr.io/<owner>/<repo>` and attaches per-OS/per-arch binaries to the GitHub release.
- **No copyrighted or trademarked names in tests, fixtures, or illustrative doc comments.** Test data, inline strings in `*_test.go`/`*.test.ts`, and code comments that show example filenames must use generic placeholders — `Game`, `Example Game 1`, `Sample Title`, `Console A`. Avoid real game titles (Mario/Sonic/Zelda/Pokemon/etc.), publisher names, and console product names (SNES/Genesis/GameCube/etc.) even as mapping-name fixtures. UI placeholder text and the user-facing `README.md` are exempt — those exist to give real users a concrete starting point and stay as-is.
