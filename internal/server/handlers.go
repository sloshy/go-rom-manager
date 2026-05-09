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
	if _, err := fsutil.EnsureUnderRoot(req.SourcePath, s.cfg.Sources); err != nil {
		writeError(w, http.StatusBadRequest, "sourcePath must be under a configured --source root")
		return
	}
	if _, err := fsutil.EnsureUnderRoot(req.DestPath, s.cfg.Dests); err != nil {
		writeError(w, http.StatusBadRequest, "destPath must be under a configured --dest root")
		return
	}
	created, err := s.store.Add(config.Mapping{
		Name:       req.Name,
		SourcePath: req.SourcePath,
		DestPath:   req.DestPath,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleGetMapping(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	m, ok := s.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "mapping not found")
		return
	}

	srcFiles, err := fsutil.ListFiles(m.SourcePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	destFiles, err := fsutil.ListFiles(m.DestPath)
	if err != nil {
		destFiles = []string{}
	}

	srcGroups := games.GroupFiles(srcFiles, m.ManualGroups)

	writeJSON(w, http.StatusOK, map[string]any{
		"mapping":              m,
		"sourceFiles":          srcFiles,
		"destFiles":            destFiles,
		"sourceGroups":         srcGroups,
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

type updateMappingReq struct {
	Name              string   `json:"name"`
	SourcePath        string   `json:"sourcePath"`
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
	if req.Name == "" || req.SourcePath == "" || req.DestPath == "" {
		writeError(w, http.StatusBadRequest, "name, sourcePath, destPath are required")
		return
	}
	if _, err := fsutil.EnsureUnderRoot(req.SourcePath, s.cfg.Sources); err != nil {
		writeError(w, http.StatusBadRequest, "sourcePath must be under a configured --source root")
		return
	}
	if _, err := fsutil.EnsureUnderRoot(req.DestPath, s.cfg.Dests); err != nil {
		writeError(w, http.StatusBadRequest, "destPath must be under a configured --dest root")
		return
	}
	m.Name = req.Name
	m.SourcePath = req.SourcePath
	m.DestPath = req.DestPath
	m.AllowedExtensions = cleanExtensions(req.AllowedExtensions)
	m.ExtractArchives = req.ExtractArchives
	ok, err := s.store.Update(m)
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
	Intended     []string          `json:"intended"`
	ManualGroups map[string]string `json:"manualGroups"`
}

// handleSync persists the request's manual-group overrides, then
// reconciles the destination directory with the intended file set:
// copy each intended file missing from dest, delete each dest file
// that has a source counterpart but is no longer intended. Files in
// dest with no source counterpart ("orange extras") are never touched.
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

	srcFiles, err := fsutil.ListFiles(m.SourcePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
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

	if err := fsutil.ExecuteSync(m.SourcePath, m.DestPath, plan, m.ExtractArchives); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"copied":  plan.ToCopy,
		"deleted": plan.ToDelete,
	})
}
