# go-rom-manager

A single-binary ROM file manager (the `rom-manager` binary, built from
this `go-rom-manager` Go module): an HTTP server that embeds a SolidJS
web UI for curating which files from "source" ROM directories should be
copied into "destination" directories.

The mental model:

- Configure one or more **sources** (e.g. `~/roms/`) and one or more
  **destinations** (e.g. `~/dest/`) at process start.
- Within the UI, create a **mapping** that pairs one source folder
  (e.g. `~/roms/snes`) with one destination folder (e.g. `~/dest/SNES`).
- Files that share a name prefix (everything before the first set of parentheses `(...)`
  group) are grouped into one **game**. Inside the editor, pick which
  variant(s) of each game should appear in the destination.
- The destination is **read-only with respect to the sources** — sync
  only ever copies into / deletes from the destination directory.
  Source files are never modified.

## Run

### From source

```bash
# Full pipeline: install web deps, typecheck, run all tests, build the
# SPA, run Go tests, produce a stripped static binary at ./rom-manager.
./scripts/bundle.sh

./rom-manager \
  --source /path/to/roms \
  --dest   /path/to/dest \
  --addr :8080
```

Pass `--skip-tests` to `bundle.sh` to skip the frontend/backend test
suites for faster local iteration.

### From Docker (no Go / Node required)

Pull from GHCR and run with your ROM tree mounted in:

```bash
docker run --rm \
  -p 8080:8080 \
  -v /path/to/roms:/roms:ro \
  -v /path/to/dest:/dest \
  -v rom-manager-data:/data \
  ghcr.io/sloshy/go-rom-manager:latest \
  --source /roms --dest /dest
```

The image runs as `nonroot`, exposes port 8080, and persists the
mappings file at `/data/mappings.json` (volume `rom-manager-data`).
Mount your source dir read-only — sync only ever writes into the
destination.

If the folder browser inside the UI shows your mounted directories as
empty, the container's `nonroot` user (UID 65532) likely can't read
host-owned files. Run the container as your own UID/GID so the bind
mounts are accessible:

```bash
docker run --rm \
  -p 8080:8080 \
  --user "$(id -u):$(id -g)" \
  -v /path/to/roms:/roms:ro \
  -v /path/to/dest:/dest \
  -v "$(pwd)/rom-manager-data":/data \
  ghcr.io/sloshy/go-rom-manager:latest \
  --source /roms --dest /dest --config /data/mappings.json
```

Note that `/data` must be writable by that UID — `mkdir rom-manager-data`
on the host before the first run (or `chown` it to match). Passing
`--config /data/mappings.json` is required when you supply your own
arguments, because positional args after the image name replace the
Dockerfile `CMD` defaults; without it the binary falls back to
`$HOME/.config/...` which the overridden user can't write.

To build locally:

```bash
docker build -t rom-manager .
```

Open <http://localhost:8080>. With no mappings configured, the UI will
prompt you to create one via a folder browser. Otherwise, pick an
existing mapping or create a new one, edit selections, and click
**SYNC** to apply.

Both flags repeat:

```bash
./rom-manager --source ~/roms --source /mnt/extra-roms --dest ~/dest
```

By default the mapping list persists at
`$XDG_CONFIG_HOME/go-rom-manager/mappings.json` (override with
`--config`).

## Selection rules

When you tick a whole game (the prefix-level checkbox) without manually
picking a file, the editor auto-selects the best variant:

1. Variants carrying a **low-priority tag** are demoted: they're only
   picked when no cleaner variant exists. The default low-priority list
   is `Demo, Proto, Sample`.
2. Walk the **preference list** top to bottom; the first tag that
   matches at least one variant wins. The default list is `USA, World`.
3. Among ties, prefer the highest `Rev N`. So for example two files `Example (Rev 1).zip` and `Example (Rev 2.zip)`, it will pick the latter.

So with the defaults, `My Game (Sample)` is selected only when there's no
plain `My Game` to choose instead.

Both lists are editable in the UI:

- **Global defaults** at `[SETTINGS]` in the header — an **AUTO-SELECT
  PRIORITY** panel (drag to reorder, edit inline, add tags like `Japan`,
  `Europe`) and a **LOW PRIORITY TAGS** panel (a chip list; order doesn't
  matter, matching is case-insensitive). Each has its own green **SAVE**
  button.
- **Per-mapping override** at `[SETTINGS]` inside a mapping editor — both
  the preference list and the low-priority list start off inheriting the
  global values; toggle **OVERRIDE FOR THIS MAPPING** to customise just
  one mapping, or **REVERT TO GLOBAL** to drop the override. Set the
  low-priority list to empty to demote nothing. The Rev tiebreaker is
  fixed and applies regardless of either list.

You can override grouping (e.g. to merge a Japanese release into the
same group as its Western counterpart) by right-clicking a source-side
filename → **MERGE INTO GROUP...**.

## Filtering

Each editor column has a chip-style filter input next to a tag-filter
dropdown.

- **Multiple terms**: separate with spaces — `Mario Galaxy` keeps only
  titles whose prefix contains both "Mario" and "Galaxy".
- **Quoted phrases**: wrap in double quotes to keep internal whitespace
  in one chip — `"Super Mario"` matches the literal phrase.
- **Negation**: prefix a term with `-` to exclude matches —
  `Mario -Demo` shows Mario titles that don't contain "Demo".
- Each committed term shows up as a chip with an × to remove. Backspace
  on an empty input removes the most recent chip.

The **TAG FILTERS** dropdown next to the input lists every parenthesised
or bracketed tag detected in the column (USA, Europe, Demo, Rev, ...).
Click a tag to cycle **off → match → exclude**. The "Filter grouped
items" toggle controls whether tag filters narrow the list at the group
level (any-or-none) or within each group (filtering individual variants
— in which case the auto-select also picks the best of the surviving
ones).

## Tests

```bash
go test ./...                 # backend
cd web && npm test            # frontend
```

## Layout

```
.
├── Dockerfile             # multi-stage: node + go → distroless static
├── scripts/bundle.sh      # full build + test pipeline → ./rom-manager
├── .github/workflows/
│   ├── test.yml           # runs on push/PR: typecheck, tests, build
│   └── release.yml        # on `v*` tag: ghcr image (amd64+arm64) + binaries
├── main.go                # CLI + embed + server bootstrap
├── internal/
│   ├── games/             # pure game-name parsing / grouping / autoselect
│   ├── fsutil/            # browse, sync diff/execute, root containment
│   ├── config/            # CLI args + persistent mappings store
│   └── server/            # HTTP handlers + SPA fallback
└── web/
    ├── src/
    │   ├── api/           # fetch wrappers around the Go API
    │   ├── components/    # SolidJS UI
    │   ├── lib/           # mirror of game logic for client display
    │   ├── stores/        # mappings + editor state
    │   ├── pages/         # Home, Editor, Settings, MappingSettings
    │   └── styles/        # retro / TUI CSS
    └── dist/              # vite build output, embedded by Go
```
