// Command rom-manager (the binary built from this go-rom-manager module)
// starts a local HTTP server that serves the embedded SolidJS UI for
// managing ROM file mappings between source and destination directories.
// Configure via repeated --source / --dest flags; --addr controls the
// bind address; --config points at the JSON file used to persist mappings.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/slosh/go-rom-manager/internal/config"
	"github.com/slosh/go-rom-manager/internal/server"
)

//go:embed all:web/dist
var distEmbed embed.FS

type stringSlice []string

func (s *stringSlice) String() string     { return fmt.Sprint(*s) }
func (s *stringSlice) Set(v string) error { *s = append(*s, v); return nil }

func main() {
	var sources, dests stringSlice
	addr := flag.String("addr", ":8080", "HTTP listen address")
	configPath := flag.String("config", defaultConfigPath(), "Path to mappings JSON file")
	flag.Var(&sources, "source", "Source directory root (repeatable)")
	flag.Var(&dests, "dest", "Destination directory root (repeatable)")
	flag.Parse()

	cfg := &config.AppConfig{
		Sources:    sources,
		Dests:      dests,
		ConfigPath: *configPath,
		Addr:       *addr,
	}
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(2)
	}

	store, err := config.NewStore(cfg.ConfigPath)
	if err != nil {
		log.Fatalf("load mappings: %v", err)
	}

	dist, err := fs.Sub(distEmbed, "web/dist")
	if err != nil {
		log.Fatalf("locate embedded web assets: %v", err)
	}

	srv := server.New(cfg, store, dist)
	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("rom-manager listening on %s", cfg.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

func defaultConfigPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "go-rom-manager", "mappings.json")
}
