// Package config holds startup configuration (validated CLI flags) and
// the persistent store of user-created mappings.
package config

import (
	"fmt"
	"os"
	"path/filepath"
)

// AppConfig is the validated configuration assembled from CLI flags
// at process startup. Sources and Dests hold absolute, existing paths.
type AppConfig struct {
	Sources    []string
	Dests      []string
	ConfigPath string
	Addr       string
}

// Validate ensures every source and destination path exists and is a
// directory, and absolutizes them in place. Returns the first error.
func (a *AppConfig) Validate() error {
	if len(a.Sources) == 0 {
		return fmt.Errorf("at least one --source is required")
	}
	if len(a.Dests) == 0 {
		return fmt.Errorf("at least one --dest is required")
	}
	if err := absolutizeAndCheck(a.Sources, "source"); err != nil {
		return err
	}
	if err := absolutizeAndCheck(a.Dests, "dest"); err != nil {
		return err
	}
	return nil
}

func absolutizeAndCheck(paths []string, label string) error {
	for i, p := range paths {
		abs, err := filepath.Abs(p)
		if err != nil {
			return fmt.Errorf("%s %q: %w", label, p, err)
		}
		info, err := os.Stat(abs)
		if err != nil {
			return fmt.Errorf("%s %q: %w", label, p, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("%s %q is not a directory", label, p)
		}
		paths[i] = abs
	}
	return nil
}
