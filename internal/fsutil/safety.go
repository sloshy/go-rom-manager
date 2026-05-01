// Package fsutil contains filesystem read/write helpers that the HTTP
// layer uses to browse source/destination roots, list ROM files, and
// execute sync operations. All path inputs are validated against a list
// of configured roots to prevent traversal outside them.
package fsutil

import (
	"fmt"
	"path/filepath"
	"strings"
)

// EnsureUnderRoot returns the absolute, cleaned path if it is contained
// within one of the given roots. It returns an error otherwise. Both the
// candidate and the roots are absolutized and symlink-evaluated by the
// caller before reaching here.
func EnsureUnderRoot(candidate string, roots []string) (string, error) {
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", fmt.Errorf("absolutize %q: %w", candidate, err)
	}
	abs = filepath.Clean(abs)
	for _, root := range roots {
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		rootAbs = filepath.Clean(rootAbs)
		if abs == rootAbs || strings.HasPrefix(abs, rootAbs+string(filepath.Separator)) {
			return abs, nil
		}
	}
	return "", fmt.Errorf("path %q is not within any configured root", candidate)
}
