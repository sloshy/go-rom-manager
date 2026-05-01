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

1. Files tagged `Demo` or `Proto` are excluded if any other variant exists.
2. Among the rest, prefer `USA`, then `World`, then anything.
3. Among ties, prefer the highest `Rev N`. So for example two files `Example (Rev 1).zip` and `Example (Rev 2.zip)`, it will pick the latter.

You can override grouping (e.g. to merge a Japanese release into the
same group as its Western counterpart) by right-clicking a source-side
filename → **MERGE INTO GROUP...**.

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
    │   ├── pages/         # Home + Editor
    │   └── styles/        # retro / TUI CSS
    └── dist/              # vite build output, embedded by Go
```
