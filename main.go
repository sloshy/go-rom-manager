// Command rom-manager (the binary built from this go-rom-manager module)
// starts a local HTTP server that serves the embedded SolidJS UI for
// managing ROM file mappings between source and destination directories.
// Configure via repeated --source / --dest flags; --addr controls the
// bind address; --config points at the JSON file used to persist mappings.
//
// Use --licenses to print the embedded dependency attribution list, and
// --license <name> to print the full license text for a single dep.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/slosh/go-rom-manager/internal/config"
	"github.com/slosh/go-rom-manager/internal/licenses"
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

	listLicenses := flag.Bool("licenses", false, "Print all dependency licenses (Go and JS) and exit")
	showLicense := flag.String("license", "", "Print the full license text for the named dependency and exit")

	flag.Parse()

	if *listLicenses {
		if err := printLicenseList(os.Stdout); err != nil {
			fmt.Fprintf(os.Stderr, "licenses: %v\n", err)
			os.Exit(1)
		}
		return
	}
	if *showLicense != "" {
		if err := printLicenseText(os.Stdout, *showLicense); err != nil {
			fmt.Fprintf(os.Stderr, "license: %v\n", err)
			os.Exit(1)
		}
		return
	}

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

// printLicenseList renders the embedded dependency manifest as two
// labelled, alphabetised lists — Go on top, JS below — so users can
// discover the exact name they need to pass to --license.
func printLicenseList(w io.Writer) error {
	m, err := licenses.Load()
	if err != nil {
		return err
	}
	printGroup := func(label string, entries []licenses.Entry) {
		fmt.Fprintf(w, "%s dependencies (%d):\n", label, len(entries))
		sorted := append([]licenses.Entry(nil), entries...)
		sort.Slice(sorted, func(i, j int) bool {
			return strings.ToLower(sorted[i].Name) < strings.ToLower(sorted[j].Name)
		})
		for _, e := range sorted {
			license := e.License
			if license == "" {
				license = "(unknown)"
			}
			version := e.Version
			if version != "" {
				fmt.Fprintf(w, "  %s %s — %s\n", e.Name, version, license)
			} else {
				fmt.Fprintf(w, "  %s — %s\n", e.Name, license)
			}
		}
	}
	printGroup("Go", m.Go)
	fmt.Fprintln(w)
	printGroup("JavaScript", m.JS)
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Use --license <name> to print the full license text for a single dep.")
	return nil
}

// printLicenseText writes the full license text for the named dep. If
// the same name appears in both buckets (rare but possible), each hit
// is printed with a header.
func printLicenseText(w io.Writer, name string) error {
	hits, err := licenses.Find(name)
	if err != nil {
		return err
	}
	if len(hits) == 0 {
		return fmt.Errorf("no dependency matched %q (try --licenses to list available names)", name)
	}
	for i, h := range hits {
		if i > 0 {
			fmt.Fprintln(w)
		}
		fmt.Fprintf(w, "=== %s [%s] %s — %s ===\n", h.Entry.Name, h.Bucket, h.Entry.Version, h.Entry.License)
		fmt.Fprintln(w, h.Entry.Text)
	}
	return nil
}
