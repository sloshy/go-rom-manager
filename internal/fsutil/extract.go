package fsutil

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
)

// ExtractZip extracts srcZip into destDir, preserving each entry's
// original basename. Subdirectory structure inside the zip is flattened
// (every entry lands directly in destDir), so two entries with the
// same basename in different subdirs produce a duplicate-name error.
//
// Atomicity is best-effort, not transactional: every entry is first
// written to a sibling temp directory, then renamed into destDir. A
// failure during the write phase leaves no files in destDir (the temp
// dir is wholly removed). A failure during the rename phase, however,
// can leave the entries already moved into destDir in place — POSIX
// has no atomic multi-file move and rolling back successful renames
// would itself need to be atomic. In practice rename within the same
// filesystem rarely fails after MkdirTemp has succeeded; callers
// should treat a non-nil error from ExtractZip as "destDir may be in
// a mixed state" and surface it to the user.
//
// Returns the list of basenames produced in destDir, sorted.
//
// Whether the produced files round-trip via the mapping's alt-extension
// rules depends entirely on the zip's inner naming — alt-ext matching
// uses games.VariantKey (prefix + non-track tags), so a zip's `.cue`
// plus its `(Track N).bin` files stay linked to the source zip even
// though their stems differ. Inner files whose names don't share a
// variant key with any source file appear as orange "no source
// counterpart" entries and must be managed manually.
func ExtractZip(srcZip, destDir string) ([]string, error) {
	zr, err := zip.OpenReader(srcZip)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	defer zr.Close()

	if len(zr.File) == 0 {
		return nil, errors.New("zip contained no extractable files")
	}

	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, fmt.Errorf("create dest dir: %w", err)
	}
	tmpDir, err := os.MkdirTemp(destDir, ".extract-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			os.RemoveAll(tmpDir)
		}
	}()

	planned := make(map[string]string, len(zr.File))
	for _, zf := range zr.File {
		if zf.FileInfo().IsDir() {
			continue
		}
		// Use the inner path's basename only — flatten subdirectories.
		// path.Base handles forward slashes (zip's standard separator)
		// and neutralizes any traversal attempt like "../escape.bin".
		inner := path.Base(zf.Name)
		if inner == "" || inner == "." || inner == "/" {
			continue
		}
		if existing, ok := planned[inner]; ok {
			return nil, fmt.Errorf("zip contains multiple entries that would flatten to %q (e.g. %q and %q)", inner, existing, zf.Name)
		}
		planned[inner] = zf.Name

		dstPath := filepath.Join(tmpDir, inner)
		if err := writeZipEntry(zf, dstPath); err != nil {
			return nil, fmt.Errorf("extract %s: %w", zf.Name, err)
		}
	}
	if len(planned) == 0 {
		return nil, errors.New("zip contained no extractable files")
	}

	produced := make([]string, 0, len(planned))
	for name := range planned {
		produced = append(produced, name)
	}
	sort.Strings(produced)
	for _, name := range produced {
		from := filepath.Join(tmpDir, name)
		to := filepath.Join(destDir, name)
		if err := os.Rename(from, to); err != nil {
			return nil, fmt.Errorf("move %s into place: %w", name, err)
		}
	}
	cleanup = false
	if err := os.Remove(tmpDir); err != nil && !os.IsNotExist(err) {
		return produced, fmt.Errorf("remove temp dir: %w", err)
	}
	return produced, nil
}

func writeZipEntry(zf *zip.File, dstPath string) error {
	rc, err := zf.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	out, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
