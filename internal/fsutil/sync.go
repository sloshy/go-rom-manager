package fsutil

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// SyncPlan captures the file-level diff between an intended destination
// state (the set of filenames that should exist in destDir) and what is
// currently on disk in destDir.
type SyncPlan struct {
	ToCopy   []string // files present in intended but missing from dest
	ToDelete []string // files present in dest but not in intended
}

// ComputeSync diffs an intended file set against the live destination
// directory and returns the operations needed to make them match.
//
// A dest file is eligible for deletion only if it has a counterpart in
// sourceFiles — i.e. it is something this mapping could have produced.
// Files in dest with no source counterpart ("orange extras") are left
// in place; they are the only files the sync is forbidden from touching.
//
// allowedExts is an optional list of dest-side alt-format extensions
// (e.g. ".rvz", ".cso") — if a dest file's extension is in the list and
// its basename matches a source file's basename, the two are treated as
// the same file for both copy-skip and managed-deletion purposes. Pass
// nil for the original strict-name behavior.
//
// All file slices contain only basenames (no path separators); destDir
// is read via ListFiles.
func ComputeSync(intended, sourceFiles []string, destDir string, allowedExts []string) (SyncPlan, error) {
	dest, err := ListFiles(destDir)
	if err != nil {
		if !os.IsNotExist(err) {
			return SyncPlan{}, err
		}
		dest = nil
	}

	wantSet := make(map[string]struct{}, len(intended))
	for _, f := range intended {
		wantSet[f] = struct{}{}
	}
	wantStems := make(map[string]struct{}, len(intended))
	for _, f := range intended {
		wantStems[stemOf(f)] = struct{}{}
	}
	haveSet := make(map[string]struct{}, len(dest))
	for _, f := range dest {
		haveSet[f] = struct{}{}
	}
	haveAltStems := make(map[string]struct{}, len(dest))
	for _, f := range dest {
		if extAllowed(f, allowedExts) {
			haveAltStems[stemOf(f)] = struct{}{}
		}
	}
	sourceSet := make(map[string]struct{}, len(sourceFiles))
	for _, f := range sourceFiles {
		sourceSet[f] = struct{}{}
	}
	sourceStems := make(map[string]struct{}, len(sourceFiles))
	for _, f := range sourceFiles {
		sourceStems[stemOf(f)] = struct{}{}
	}

	plan := SyncPlan{}
	for f := range wantSet {
		if _, ok := haveSet[f]; ok {
			continue
		}
		if _, ok := haveAltStems[stemOf(f)]; ok {
			continue
		}
		plan.ToCopy = append(plan.ToCopy, f)
	}
	for f := range haveSet {
		if _, want := wantSet[f]; want {
			continue
		}
		if extAllowed(f, allowedExts) {
			if _, want := wantStems[stemOf(f)]; want {
				continue
			}
		}
		managed := false
		if _, ok := sourceSet[f]; ok {
			managed = true
		} else if extAllowed(f, allowedExts) {
			if _, ok := sourceStems[stemOf(f)]; ok {
				managed = true
			}
		}
		if !managed {
			continue
		}
		plan.ToDelete = append(plan.ToDelete, f)
	}
	return plan, nil
}

// stemOf returns the filename with its trailing extension stripped, using
// the same last-dot rule as filepath.Ext.
func stemOf(name string) string {
	return strings.TrimSuffix(name, filepath.Ext(name))
}

// extAllowed reports whether the file's extension appears in the allowed
// list. The allowed list is expected to be normalized to lowercase with a
// leading dot (e.g. ".rvz"); the file's extension is lowercased before
// comparison so case differences on disk are tolerated.
func extAllowed(name string, allowed []string) bool {
	if len(allowed) == 0 {
		return false
	}
	ext := strings.ToLower(filepath.Ext(name))
	for _, a := range allowed {
		if a == ext {
			return true
		}
	}
	return false
}

// ExecuteSync applies a SyncPlan: it copies each ToCopy file from srcDir
// into destDir (atomically, via a temp file + rename) and removes each
// ToDelete file from destDir. The source directory is never modified.
//
// destDir is created if it does not exist.
func ExecuteSync(srcDir, destDir string, plan SyncPlan) error {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}
	for _, name := range plan.ToCopy {
		src := filepath.Join(srcDir, name)
		dst := filepath.Join(destDir, name)
		if err := copyAtomic(src, dst); err != nil {
			return fmt.Errorf("copy %s: %w", name, err)
		}
	}
	for _, name := range plan.ToDelete {
		dst := filepath.Join(destDir, name)
		if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("delete %s: %w", name, err)
		}
	}
	return nil
}

func copyAtomic(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmp, err := os.CreateTemp(filepath.Dir(dst), ".sync-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, dst)
}
