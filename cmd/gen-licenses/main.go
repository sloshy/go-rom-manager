// Command gen-licenses walks the project's Go and JavaScript dependencies
// at build time and writes their attribution metadata + license text to
// internal/licenses/manifest.json. The runtime binary embeds that file
// (see internal/licenses) and exposes it via the CLI and the web app.
//
// Run from the repo root:
//
//	go run ./cmd/gen-licenses
//
// The JS scan reads web/node_modules, so `npm ci` (or `npm install`) must
// have been run in web/ before invocation. If node_modules is missing the
// JS section will be empty and a warning is logged; the Go section and
// the project's own license are still emitted.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type entry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	License string `json:"license"`
	Text    string `json:"text"`
}

type manifest struct {
	Go []entry `json:"go"`
	JS []entry `json:"js"`
}

func main() {
	repoRoot, err := findRepoRoot()
	if err != nil {
		log.Fatalf("locate repo root: %v", err)
	}

	m := manifest{Go: []entry{}, JS: []entry{}}

	project, err := projectEntry(repoRoot)
	if err != nil {
		log.Fatalf("read project license: %v", err)
	}
	m.Go = append(m.Go, project)
	m.Go = append(m.Go, goRuntimeEntry())

	goDeps, err := collectGoModules(repoRoot)
	if err != nil {
		log.Fatalf("collect Go modules: %v", err)
	}
	m.Go = append(m.Go, goDeps...)

	jsDeps, err := collectJSModules(filepath.Join(repoRoot, "web"))
	if err != nil {
		log.Printf("warning: collect JS modules: %v (the JS section will be empty)", err)
	}
	m.JS = append(m.JS, jsDeps...)

	sortByName(m.Go[2:]) // keep project + Go-runtime pinned at the top
	sortByName(m.JS)

	out := filepath.Join(repoRoot, "internal", "licenses", "manifest.json")
	if err := writeManifest(out, m); err != nil {
		log.Fatalf("write manifest: %v", err)
	}
	fmt.Printf("wrote %s (go=%d js=%d)\n", out, len(m.Go), len(m.JS))
}

func sortByName(es []entry) {
	sort.Slice(es, func(i, j int) bool { return strings.ToLower(es[i].Name) < strings.ToLower(es[j].Name) })
}

func writeManifest(path string, m manifest) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func findRepoRoot() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := cwd
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("go.mod not found from %s", cwd)
		}
		dir = parent
	}
}

// projectEntry reads the repo's top-level LICENSE file and labels it as
// the main module's attribution.
func projectEntry(repoRoot string) (entry, error) {
	text, err := readLicenseAtPath(repoRoot)
	if err != nil {
		return entry{}, err
	}
	return entry{
		Name:    "github.com/slosh/go-rom-manager",
		Version: "(this binary)",
		License: detectLicense(text),
		Text:    text,
	}, nil
}

// goRuntimeEntry includes the Go standard-library / runtime license.
// The binary statically links against it, so attribution is required.
// The text is sourced from the local Go installation when available;
// otherwise a short pointer is emitted so the manifest still validates.
func goRuntimeEntry() entry {
	version := strings.TrimPrefix(runtimeGoVersion(), "go")
	text := readGoRuntimeLicense()
	if text == "" {
		text = "Go runtime license text was not located at build time. " +
			"See https://go.dev/LICENSE for the upstream BSD-3-Clause license."
	}
	return entry{
		Name:    "Go runtime (standard library)",
		Version: version,
		License: "BSD-3-Clause",
		Text:    text,
	}
}

func runtimeGoVersion() string {
	out, err := exec.Command("go", "env", "GOVERSION").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func readGoRuntimeLicense() string {
	out, err := exec.Command("go", "env", "GOROOT").Output()
	if err != nil {
		return ""
	}
	root := strings.TrimSpace(string(out))
	if root == "" {
		return ""
	}
	text, err := readLicenseAtPath(root)
	if err != nil {
		return ""
	}
	return text
}

// collectGoModules walks `go list -m -json all` and produces an entry per
// external module (the main module is excluded — it's handled by
// projectEntry). License text is read from each module's on-disk Dir.
func collectGoModules(repoRoot string) ([]entry, error) {
	cmd := exec.Command("go", "list", "-m", "-json", "all")
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("go list: %w", err)
	}
	type goMod struct {
		Path     string
		Version  string
		Main     bool
		Dir      string
		Indirect bool
	}
	dec := json.NewDecoder(strings.NewReader(string(out)))
	var entries []entry
	for dec.More() {
		var m goMod
		if err := dec.Decode(&m); err != nil {
			return nil, err
		}
		if m.Main || m.Path == "" || m.Dir == "" {
			continue
		}
		text, err := readLicenseAtPath(m.Dir)
		if err != nil {
			text = fmt.Sprintf("License file was not located in %s.", m.Dir)
		}
		entries = append(entries, entry{
			Name:    m.Path,
			Version: m.Version,
			License: detectLicense(text),
			Text:    text,
		})
	}
	return entries, nil
}

// collectJSModules walks the production npm dependency tree from
// `npm ls --omit=dev --all --json` (run inside webDir) and reads each
// package's metadata + license text from web/node_modules.
func collectJSModules(webDir string) ([]entry, error) {
	if _, err := os.Stat(filepath.Join(webDir, "node_modules")); err != nil {
		return nil, fmt.Errorf("node_modules missing under %s — run `npm ci` first", webDir)
	}
	cmd := exec.Command("npm", "ls", "--omit=dev", "--all", "--json")
	cmd.Dir = webDir
	out, err := cmd.Output()
	// `npm ls` exits non-zero on any extraneous/peer issues even when the
	// JSON tree is fine. Tolerate that and parse whatever we got.
	if err != nil && len(out) == 0 {
		return nil, fmt.Errorf("npm ls: %w", err)
	}
	var tree struct {
		Dependencies map[string]npmNode `json:"dependencies"`
	}
	if err := json.Unmarshal(out, &tree); err != nil {
		return nil, fmt.Errorf("parse npm ls output: %w", err)
	}
	flat := map[string]string{} // name -> version (first seen wins)
	flattenNpm(tree.Dependencies, flat)
	out2 := make([]entry, 0, len(flat))
	for name, version := range flat {
		dir := filepath.Join(webDir, "node_modules", filepath.FromSlash(name))
		text, err := readLicenseAtPath(dir)
		if err != nil {
			text = fmt.Sprintf("License file was not located in %s.", dir)
		}
		license := detectLicense(text)
		if pkg, err := readNpmPackageJSON(dir); err == nil {
			if l := pkg.licenseField(); l != "" {
				license = l
			}
		}
		out2 = append(out2, entry{
			Name:    name,
			Version: version,
			License: license,
			Text:    text,
		})
	}
	return out2, nil
}

type npmNode struct {
	Version      string             `json:"version"`
	Dependencies map[string]npmNode `json:"dependencies"`
}

func flattenNpm(deps map[string]npmNode, out map[string]string) {
	for name, node := range deps {
		if _, seen := out[name]; !seen && node.Version != "" {
			out[name] = node.Version
		}
		flattenNpm(node.Dependencies, out)
	}
}

type npmPackage struct {
	License  any `json:"license"`  // string or { "type": "..." }
	Licenses any `json:"licenses"` // legacy array form
}

func (p npmPackage) licenseField() string {
	switch v := p.License.(type) {
	case string:
		return strings.TrimSpace(v)
	case map[string]any:
		if t, ok := v["type"].(string); ok {
			return strings.TrimSpace(t)
		}
	}
	if arr, ok := p.Licenses.([]any); ok && len(arr) > 0 {
		if obj, ok := arr[0].(map[string]any); ok {
			if t, ok := obj["type"].(string); ok {
				return strings.TrimSpace(t)
			}
		}
	}
	return ""
}

func readNpmPackageJSON(dir string) (npmPackage, error) {
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return npmPackage{}, err
	}
	var p npmPackage
	if err := json.Unmarshal(data, &p); err != nil {
		return npmPackage{}, err
	}
	return p, nil
}

// readLicenseAtPath looks for a license file in dir using a short list of
// conventional names (case-insensitive). Returns the file's text or an
// error if no candidate exists.
var licenseFilenames = []string{
	"LICENSE",
	"LICENSE.txt",
	"LICENSE.md",
	"LICENCE",
	"LICENCE.txt",
	"LICENCE.md",
	"COPYING",
	"COPYING.txt",
	"COPYING.md",
	"LICENSE-MIT",
	"LICENSE.MIT",
	"LICENSE-APACHE",
	"LICENSE.APACHE",
}

func readLicenseAtPath(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	byLower := map[string]string{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		byLower[strings.ToLower(e.Name())] = e.Name()
	}
	for _, candidate := range licenseFilenames {
		if real, ok := byLower[strings.ToLower(candidate)]; ok {
			data, err := os.ReadFile(filepath.Join(dir, real))
			if err != nil {
				return "", err
			}
			return string(data), nil
		}
	}
	return "", fmt.Errorf("no license file in %s", dir)
}

// detectLicense returns a coarse SPDX-ish identifier inferred from the
// first ~40 lines of license text. It's a best-effort label; the exact
// terms always come from the embedded text.
func detectLicense(text string) string {
	head := strings.ToLower(text)
	if len(head) > 4096 {
		head = head[:4096]
	}
	switch {
	case strings.Contains(head, "gnu affero general public license"):
		return "AGPL-3.0"
	case strings.Contains(head, "gnu general public license") && strings.Contains(head, "version 3"):
		return "GPL-3.0"
	case strings.Contains(head, "gnu lesser general public license"):
		return "LGPL"
	case strings.Contains(head, "apache license") && strings.Contains(head, "version 2.0"):
		return "Apache-2.0"
	case strings.Contains(head, "mozilla public license"):
		return "MPL-2.0"
	case strings.Contains(head, "mit license") || strings.Contains(head, "permission is hereby granted, free of charge"):
		return "MIT"
	case strings.Contains(head, "redistribution and use in source and binary forms"):
		if strings.Contains(head, "neither the name") {
			return "BSD-3-Clause"
		}
		return "BSD-2-Clause"
	case strings.Contains(head, "the unlicense"):
		return "Unlicense"
	case strings.Contains(head, "isc license"):
		return "ISC"
	}
	return ""
}
