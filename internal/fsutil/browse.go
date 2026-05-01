package fsutil

import (
	"os"
	"path/filepath"
	"sort"
)

// Entry is one immediate child of a browsed directory.
type Entry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
}

// Browse returns the immediate children of dir, after verifying that
// dir is contained in one of the given roots. Children are sorted
// directories-first, then alphabetically (case-insensitive).
func Browse(dir string, roots []string) ([]Entry, error) {
	abs, err := EnsureUnderRoot(dir, roots)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(entries))
	for _, e := range entries {
		out = append(out, Entry{Name: e.Name(), IsDir: e.IsDir()})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return foldLess(out[i].Name, out[j].Name)
	})
	return out, nil
}

// ListFiles returns the names of regular files (not directories) in dir.
func ListFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		out = append(out, e.Name())
	}
	sort.Slice(out, func(i, j int) bool { return foldLess(out[i], out[j]) })
	return out, nil
}

// PathJoin joins base and sub, returning the cleaned absolute path.
// It does not validate containment; callers should pass the result
// through EnsureUnderRoot if it came from user input.
func PathJoin(base, sub string) string {
	return filepath.Clean(filepath.Join(base, sub))
}

func foldLess(a, b string) bool {
	la, lb := len(a), len(b)
	n := la
	if lb < n {
		n = lb
	}
	for i := 0; i < n; i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 32
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 32
		}
		if ca != cb {
			return ca < cb
		}
	}
	return la < lb
}
