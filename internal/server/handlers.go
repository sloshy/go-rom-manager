package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/slosh/go-rom-manager/internal/config"
	"github.com/slosh/go-rom-manager/internal/fsutil"
	"github.com/slosh/go-rom-manager/internal/games"
	"github.com/slosh/go-rom-manager/internal/licenses"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"sources": s.cfg.Sources,
		"dests":   s.cfg.Dests,
	})
}

func (s *Server) handleBrowse(w http.ResponseWriter, r *http.Request) {
	root := r.URL.Query().Get("root")
	sub := r.URL.Query().Get("sub")
	if root == "" {
		writeError(w, http.StatusBadRequest, "root query param is required")
		return
	}
	allRoots := append(append([]string{}, s.cfg.Sources...), s.cfg.Dests...)
	target := filepath.Join(root, sub)
	entries, err := fsutil.Browse(target, allRoots)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    target,
		"entries": entries,
	})
}

// handleGetLicenses returns the embedded dependency attribution
// manifest. Load() is called only to surface a parse error if the
// embedded JSON is somehow malformed; on success we stream the raw
// bytes to avoid re-encoding ~40KB of license text per request.
func (s *Server) handleGetLicenses(w http.ResponseWriter, _ *http.Request) {
	if _, err := licenses.Load(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(licenses.Raw())
}

func (s *Server) handleListMappings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"mappings": s.store.All()})
}

type createMappingReq struct {
	Name       string `json:"name"`
	SourcePath string `json:"sourcePath"`
	DestPath   string `json:"destPath"`
}

func (s *Server) handleCreateMapping(w http.ResponseWriter, r *http.Request) {
	var req createMappingReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" || req.SourcePath == "" || req.DestPath == "" {
		writeError(w, http.StatusBadRequest, "name, sourcePath, destPath are required")
		return
	}
	// Store the canonical (absolutized, cleaned) paths so the persisted
	// mapping matches what EnsureUnderRoot produces elsewhere (e.g. the
	// per-file source validation in handleSync).
	sourcePath, err := fsutil.EnsureUnderRoot(req.SourcePath, s.cfg.Sources)
	if err != nil {
		writeError(w, http.StatusBadRequest, "sourcePath must be under a configured --source root")
		return
	}
	destPath, err := fsutil.EnsureUnderRoot(req.DestPath, s.cfg.Dests)
	if err != nil {
		writeError(w, http.StatusBadRequest, "destPath must be under a configured --dest root")
		return
	}
	created, err := s.store.Add(config.Mapping{
		Name:        req.Name,
		SourcePaths: []string{sourcePath},
		DestPath:    destPath,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

// sourceView is one configured source directory's contents, returned in
// configured order so the editor can render the source-switcher dropdown
// and show whichever source is active. A source dir that can't be read
// (missing/permission) yields an empty file list rather than failing the
// whole request — one bad source shouldn't break editing the others.
type sourceView struct {
	Path   string        `json:"path"`
	Files  []string      `json:"files"`
	Groups []games.Group `json:"groups"`
}

func (s *Server) handleGetMapping(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	m, ok := s.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "mapping not found")
		return
	}

	sources := make([]sourceView, 0, len(m.SourcePaths))
	for _, sp := range m.SourcePaths {
		files, err := fsutil.ListFiles(sp)
		if err != nil {
			files = []string{}
		}
		sources = append(sources, sourceView{
			Path:   sp,
			Files:  files,
			Groups: games.GroupFiles(files, m.ManualGroups),
		})
	}

	destFiles, err := fsutil.ListFiles(m.DestPath)
	if err != nil {
		destFiles = []string{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"mapping":              m,
		"sources":              sources,
		"destFiles":            destFiles,
		"effectivePreferences": s.effectivePreferences(m),
	})
}

// effectivePreferences resolves the preference list that should drive
// auto-select for the given mapping: per-mapping override (if set),
// otherwise the persisted global preferences, otherwise the project default.
func (s *Server) effectivePreferences(m config.Mapping) []string {
	if m.Preferences != nil {
		out := make([]string, len(*m.Preferences))
		copy(out, *m.Preferences)
		return out
	}
	if g := s.store.GlobalPreferences(); g != nil {
		return g
	}
	out := make([]string, len(games.DefaultPreferences))
	copy(out, games.DefaultPreferences)
	return out
}

type preferencesPayload struct {
	Preferences []string `json:"preferences"`
}

func (s *Server) handleGetSettings(w http.ResponseWriter, _ *http.Request) {
	prefs := s.store.GlobalPreferences()
	if prefs == nil {
		prefs = append([]string(nil), games.DefaultPreferences...)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"preferences":        prefs,
		"defaultPreferences": games.DefaultPreferences,
	})
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req preferencesPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	cleaned, err := cleanPreferences(req.Preferences)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SetGlobalPreferences(cleaned); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"preferences": cleaned})
}

// mappingPreferencesPayload's pointer field distinguishes "field omitted /
// null → inherit global" from "explicit list (possibly empty) → override".
type mappingPreferencesPayload struct {
	Preferences *[]string `json:"preferences"`
}

func (s *Server) handleUpdateMappingPreferences(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req mappingPreferencesPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	var override *[]string
	if req.Preferences != nil {
		cleaned, err := cleanPreferences(*req.Preferences)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		override = &cleaned
	}

	ok, err := s.store.SetMappingPreferences(id, override)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "mapping not found")
		return
	}
	m, _ := s.store.Get(id)
	writeJSON(w, http.StatusOK, map[string]any{
		"mapping":              m,
		"effectivePreferences": s.effectivePreferences(m),
	})
}

// cleanPreferences trims whitespace, drops empty entries, and rejects
// duplicates (case-insensitive). The returned slice is always non-nil
// (empty if every entry was blank) so callers can distinguish "explicit
// empty override" from a nil "inherit" sentinel up the stack.
func cleanPreferences(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, p := range in {
		t := strings.TrimSpace(p)
		if t == "" {
			continue
		}
		key := strings.ToLower(t)
		if _, dup := seen[key]; dup {
			return nil, fmt.Errorf("duplicate preference: %q", t)
		}
		seen[key] = struct{}{}
		out = append(out, t)
	}
	return out, nil
}

// cleanExtensions normalizes a list of allowed alt-format extensions:
// trim whitespace, drop empty/blank entries, lowercase, ensure a single
// leading dot, silently dedupe. Unlike cleanPreferences this does not
// error on duplicates — tag-style inputs naturally produce them and the
// canonical form is identical, so silently coalescing is friendlier.
func cleanExtensions(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, e := range in {
		t := strings.TrimSpace(e)
		t = strings.TrimPrefix(t, ".")
		if t == "" {
			continue
		}
		norm := "." + strings.ToLower(t)
		if _, dup := seen[norm]; dup {
			continue
		}
		seen[norm] = struct{}{}
		out = append(out, norm)
	}
	return out
}

// cleanSourcePaths validates a mapping's source folder list: it trims
// blanks, requires every entry to resolve under a configured --source
// root (absolutizing it via EnsureUnderRoot), dedupes while preserving
// order, and requires at least one survivor. The returned paths are
// absolute and cleaned.
func (s *Server) cleanSourcePaths(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, p := range in {
		t := strings.TrimSpace(p)
		if t == "" {
			continue
		}
		abs, err := fsutil.EnsureUnderRoot(t, s.cfg.Sources)
		if err != nil {
			return nil, fmt.Errorf("source %q must be under a configured --source root", t)
		}
		if _, dup := seen[abs]; dup {
			continue
		}
		seen[abs] = struct{}{}
		out = append(out, abs)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("at least one source folder is required")
	}
	return out, nil
}

// mustAbs absolutizes a path, falling back to the input if the working
// directory can't be resolved (which effectively never happens). Used to
// canonicalize stored source paths for comparison against EnsureUnderRoot
// output.
func mustAbs(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}

// resolvePrimarySource validates an optional primary-source selection: an
// empty value means "use the first configured source" and resolves to "".
// A non-empty value must absolutize (under a --source root) to one of the
// already-cleaned sources. Returns the canonical absolute path to store.
func resolvePrimarySource(primary string, sources, roots []string) (string, error) {
	t := strings.TrimSpace(primary)
	if t == "" {
		return "", nil
	}
	abs, err := fsutil.EnsureUnderRoot(t, roots)
	if err != nil {
		return "", fmt.Errorf("primarySource must be under a configured --source root")
	}
	for _, sp := range sources {
		if sp == abs {
			return abs, nil
		}
	}
	return "", fmt.Errorf("primarySource must be one of the mapping's source folders")
}

type updateMappingReq struct {
	Name              string   `json:"name"`
	SourcePaths       []string `json:"sourcePaths"`
	PrimarySource     string   `json:"primarySource"`
	DestPath          string   `json:"destPath"`
	AllowedExtensions []string `json:"allowedExtensions"`
	ExtractArchives   bool     `json:"extractArchives"`
}

func (s *Server) handleUpdateMapping(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	m, ok := s.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "mapping not found")
		return
	}
	var req updateMappingReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" || req.DestPath == "" {
		writeError(w, http.StatusBadRequest, "name and destPath are required")
		return
	}
	sources, err := s.cleanSourcePaths(req.SourcePaths)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	destPath, err := fsutil.EnsureUnderRoot(req.DestPath, s.cfg.Dests)
	if err != nil {
		writeError(w, http.StatusBadRequest, "destPath must be under a configured --dest root")
		return
	}
	primary, err := resolvePrimarySource(req.PrimarySource, sources, s.cfg.Sources)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	m.Name = req.Name
	m.SourcePaths = sources
	m.PrimarySource = primary
	m.DestPath = destPath
	m.AllowedExtensions = cleanExtensions(req.AllowedExtensions)
	m.ExtractArchives = req.ExtractArchives
	ok, err = s.store.Update(m)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "mapping not found")
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleDeleteMapping(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ok, err := s.store.Delete(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "mapping not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type syncReq struct {
	Intended     []fsutil.SourceFile `json:"intended"`
	ManualGroups map[string]string   `json:"manualGroups"`
}

// handleSync persists the request's manual-group overrides, then
// reconciles the destination directory against the intended file set
// drawn from the union of the mapping's source directories: copy each
// intended file missing from dest (from the source dir it was selected
// from), delete each dest file that has a source counterpart but is no
// longer intended. Files in dest with no source counterpart ("orange
// extras") are never touched.
//
// Each intended file's Dir must be one of the mapping's configured
// source folders — this both fixes the copy origin and guards against a
// client asking the server to copy from an arbitrary directory.
func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	m, ok := s.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "mapping not found")
		return
	}

	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ManualGroups == nil {
		req.ManualGroups = map[string]string{}
	}

	// Validate and canonicalize each intended file's source dir against
	// the mapping's configured sources, and accumulate the union of all
	// source files for the deletion ("managed") oracle. The allowed set is
	// keyed on absolutized+cleaned paths so it matches EnsureUnderRoot's
	// canonical output even for mappings whose stored paths predate
	// canonicalization (e.g. migrated legacy entries).
	allowed := make(map[string]struct{}, len(m.SourcePaths))
	for _, sp := range m.SourcePaths {
		allowed[filepath.Clean(mustAbs(sp))] = struct{}{}
	}
	for i := range req.Intended {
		abs, err := fsutil.EnsureUnderRoot(req.Intended[i].Dir, s.cfg.Sources)
		if err != nil {
			writeError(w, http.StatusBadRequest, "intended file source must be under a configured --source root")
			return
		}
		if _, ok := allowed[abs]; !ok {
			writeError(w, http.StatusBadRequest, "intended file source is not one of this mapping's source folders")
			return
		}
		req.Intended[i].Dir = abs
	}

	var srcFiles []string
	for _, sp := range m.SourcePaths {
		files, err := fsutil.ListFiles(sp)
		if err != nil {
			continue
		}
		srcFiles = append(srcFiles, files...)
	}

	plan, err := fsutil.ComputeSync(req.Intended, srcFiles, m.DestPath, m.AllowedExtensions)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	m.ManualGroups = req.ManualGroups
	if _, err := s.store.Update(m); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := fsutil.ExecuteSync(m.DestPath, plan, m.ExtractArchives); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	copied := make([]string, len(plan.ToCopy))
	for i, f := range plan.ToCopy {
		copied[i] = f.Name
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"copied":  copied,
		"deleted": plan.ToDelete,
	})
}
