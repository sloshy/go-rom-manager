package server

import (
	"encoding/json"
	"net/http"
	"path/filepath"

	"github.com/slosh/go-rom-manager/internal/config"
	"github.com/slosh/go-rom-manager/internal/fsutil"
	"github.com/slosh/go-rom-manager/internal/games"
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
		"mapping":          m,
		"sourceFiles":      srcFiles,
		"destFiles":        destFiles,
		"sourceGroups":     srcGroups,
	})
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

	plan, err := fsutil.ComputeSync(req.Intended, srcFiles, m.DestPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	m.ManualGroups = req.ManualGroups
	if _, err := s.store.Update(m); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := fsutil.ExecuteSync(m.SourcePath, m.DestPath, plan); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"copied":  plan.ToCopy,
		"deleted": plan.ToDelete,
	})
}
