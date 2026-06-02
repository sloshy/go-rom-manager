// Package server wires together the JSON API and the embedded SolidJS
// SPA. Construct one with New, then mount its Handler() on an http.Server.
package server

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/slosh/go-rom-manager/internal/config"
)

// Server holds the configured app state and the static-asset filesystem.
type Server struct {
	cfg   *config.AppConfig
	store *config.Store
	dist  fs.FS
}

// New returns a Server backed by the given runtime config, mappings
// store, and static-asset filesystem (typically rooted at web/dist).
func New(cfg *config.AppConfig, store *config.Store, distFS fs.FS) *Server {
	return &Server{cfg: cfg, store: store, dist: distFS}
}

// Handler builds the http.Handler that mounts /api/* on the JSON
// endpoints and falls through to the embedded SPA for everything else,
// rewriting unknown paths to /index.html so client-side routes resolve.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/config", s.handleGetConfig)
	mux.HandleFunc("GET /api/browse", s.handleBrowse)
	mux.HandleFunc("GET /api/licenses", s.handleGetLicenses)
	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/settings", s.handleUpdateSettings)
	mux.HandleFunc("GET /api/mappings", s.handleListMappings)
	mux.HandleFunc("POST /api/mappings", s.handleCreateMapping)
	mux.HandleFunc("GET /api/mappings/{id}", s.handleGetMapping)
	mux.HandleFunc("PUT /api/mappings/{id}", s.handleUpdateMapping)
	mux.HandleFunc("DELETE /api/mappings/{id}", s.handleDeleteMapping)
	mux.HandleFunc("PUT /api/mappings/{id}/preferences", s.handleUpdateMappingPreferences)
	mux.HandleFunc("PUT /api/mappings/{id}/low-priority-tags", s.handleUpdateMappingLowPriorityTags)
	mux.HandleFunc("POST /api/mappings/{id}/sync", s.handleSync)

	mux.Handle("/", spaFileServer(s.dist))
	return mux
}

// spaFileServer serves files from distFS, falling back to index.html so
// that client-side routes (e.g. /mapping/abc) resolve to the SPA shell.
func spaFileServer(distFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(distFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		clean := path.Clean(r.URL.Path)
		if clean == "/" {
			serveIndex(w, distFS)
			return
		}
		f, err := distFS.Open(strings.TrimPrefix(clean, "/"))
		if err != nil {
			serveIndex(w, distFS)
			return
		}
		_ = f.Close()
		fileServer.ServeHTTP(w, r)
	})
}

func serveIndex(w http.ResponseWriter, distFS fs.FS) {
	data, err := fs.ReadFile(distFS, "index.html")
	if err != nil {
		http.Error(w, "index.html missing", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
