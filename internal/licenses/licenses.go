// Package licenses exposes the build-time-generated dependency
// attribution manifest. The manifest is produced by `cmd/gen-licenses`
// (run as part of scripts/bundle.sh) and embedded into the binary so
// that both the CLI and the web app can surface license text without
// any filesystem dependencies at runtime.
package licenses

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

//go:embed manifest.json
var manifestJSON []byte

// Entry describes a single dependency: its name, version, a coarse
// license identifier, and the full license text.
type Entry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	License string `json:"license"`
	Text    string `json:"text"`
}

// Manifest is the parsed shape of the embedded manifest.json. The two
// buckets group dependencies by language so callers (CLI, web app) can
// render or filter on that distinction.
type Manifest struct {
	Go []Entry `json:"go"`
	JS []Entry `json:"js"`
}

var (
	parseOnce sync.Once
	parsed    Manifest
	parseErr  error
)

// Load returns the embedded manifest. The result is cached after the
// first call. It returns an error only if the embedded JSON is somehow
// malformed (which would be a build-time bug).
func Load() (Manifest, error) {
	parseOnce.Do(func() {
		if len(manifestJSON) == 0 {
			parsed = Manifest{}
			return
		}
		parseErr = json.Unmarshal(manifestJSON, &parsed)
	})
	return parsed, parseErr
}

// Raw exposes the embedded JSON bytes for callers that just want to
// pipe the manifest through (e.g. the HTTP handler).
func Raw() []byte { return manifestJSON }

// Find looks up an entry by case-insensitive exact match against Name.
// If there are multiple matches across the Go and JS buckets, all
// candidates are returned so the caller can disambiguate. The bucket
// ("go" or "js") is returned alongside each hit.
type Match struct {
	Bucket string
	Entry  Entry
}

func Find(name string) ([]Match, error) {
	m, err := Load()
	if err != nil {
		return nil, err
	}
	target := strings.ToLower(strings.TrimSpace(name))
	if target == "" {
		return nil, fmt.Errorf("dependency name is required")
	}
	var hits []Match
	for _, e := range m.Go {
		if strings.ToLower(e.Name) == target {
			hits = append(hits, Match{Bucket: "go", Entry: e})
		}
	}
	for _, e := range m.JS {
		if strings.ToLower(e.Name) == target {
			hits = append(hits, Match{Bucket: "js", Entry: e})
		}
	}
	return hits, nil
}
