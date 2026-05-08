package fsutil

import (
	"archive/zip"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// makeZip writes a zip at path containing the given entries (name → content).
// Use forward slashes in entry names for paths inside the zip.
func makeZip(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := zip.NewWriter(f)
	defer w.Close()
	for name, content := range entries {
		zf, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := zf.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExtractZip_PreservesEntryNames(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "Sample Title (USA).zip")
	makeZip(t, zipPath, map[string]string{
		"Sample Title.cue":           "CUE",
		"Sample Title (Track 1).bin": "BIN1",
		"Sample Title (Track 2).bin": "BIN2",
	})
	dst := t.TempDir()

	produced, err := ExtractZip(zipPath, dst)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(produced)
	want := []string{
		"Sample Title (Track 1).bin",
		"Sample Title (Track 2).bin",
		"Sample Title.cue",
	}
	if len(produced) != len(want) {
		t.Fatalf("produced=%v, want %v", produced, want)
	}
	for i, n := range want {
		if produced[i] != n {
			t.Errorf("produced[%d]=%q, want %q", i, produced[i], n)
		}
	}

	cue, err := os.ReadFile(filepath.Join(dst, "Sample Title.cue"))
	if err != nil || string(cue) != "CUE" {
		t.Errorf("cue content=%q err=%v", cue, err)
	}
	bin1, _ := os.ReadFile(filepath.Join(dst, "Sample Title (Track 1).bin"))
	if string(bin1) != "BIN1" {
		t.Errorf("track1 content=%q, want BIN1", bin1)
	}
}

func TestExtractZip_FlattensSubdirectories(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "Game.zip")
	makeZip(t, zipPath, map[string]string{
		"nested/deeper/rom.bin": "x",
	})
	dst := t.TempDir()

	produced, err := ExtractZip(zipPath, dst)
	if err != nil {
		t.Fatal(err)
	}
	if len(produced) != 1 || produced[0] != "rom.bin" {
		t.Errorf("produced=%v, want [rom.bin]", produced)
	}
	entries, err := ListFiles(dst)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0] != "rom.bin" {
		t.Errorf("dest=%v, want [rom.bin] (no subdirs)", entries)
	}
}

func TestExtractZip_RejectsFlattenCollisions(t *testing.T) {
	// Two entries with the same basename in different subdirs both
	// flatten to the same dest filename → error.
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "Game.zip")
	makeZip(t, zipPath, map[string]string{
		"a/rom.bin": "1",
		"b/rom.bin": "2",
	})
	dst := t.TempDir()

	if _, err := ExtractZip(zipPath, dst); err == nil {
		t.Error("expected error for duplicate flattened basenames, got nil")
	}
	// Failure should leave dest empty (no partial extraction).
	entries, _ := ListFiles(dst)
	if len(entries) != 0 {
		t.Errorf("dest=%v, want empty after failed extraction", entries)
	}
}

func TestExtractZip_RejectsZipSlip(t *testing.T) {
	// path.Base flattens "../../etc/passwd" to "passwd", so the entry
	// can't escape destDir even if it tries.
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "Game.zip")
	makeZip(t, zipPath, map[string]string{
		"../../../../tmp/escaped.bin": "evil",
	})
	dst := t.TempDir()

	produced, err := ExtractZip(zipPath, dst)
	if err != nil {
		t.Fatal(err)
	}
	if len(produced) != 1 || produced[0] != "escaped.bin" {
		t.Errorf("produced=%v, want [escaped.bin] (path traversal flattened)", produced)
	}
	if _, err := os.Stat(filepath.Join(dst, "escaped.bin")); err != nil {
		t.Errorf("expected escaped.bin under dest, got %v", err)
	}
}

func TestExtractZip_EmptyZipErrors(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "Empty.zip")
	makeZip(t, zipPath, map[string]string{})
	dst := t.TempDir()

	if _, err := ExtractZip(zipPath, dst); err == nil {
		t.Error("expected error for empty zip, got nil")
	}
}

func TestExecuteSync_ExtractPreservesNames(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()

	zipPath := filepath.Join(src, "Sample Title.zip")
	makeZip(t, zipPath, map[string]string{
		"Sample Title.cue":           "CUE",
		"Sample Title (Track 1).bin": "BIN",
	})

	// Inner names share the zip's VariantKey ("Sample Title"), so
	// alt-ext variant-key matching keeps them connected to the source
	// for sync purposes — including the (Track 1) file whose stem
	// differs but whose VariantKey is the same.
	intended := []string{"Sample Title.zip"}
	sourceFiles := []string{"Sample Title.zip"}
	allowedExts := []string{".bin", ".cue"}

	plan, err := ComputeSync(intended, sourceFiles, dst, allowedExts)
	if err != nil {
		t.Fatal(err)
	}
	if err := ExecuteSync(src, dst, plan, true); err != nil {
		t.Fatal(err)
	}
	entries, _ := ListFiles(dst)
	sort.Strings(entries)
	wantEntries := []string{"Sample Title (Track 1).bin", "Sample Title.cue"}
	if len(entries) != len(wantEntries) {
		t.Fatalf("after extract dest=%v, want %v", entries, wantEntries)
	}
	for i, n := range wantEntries {
		if entries[i] != n {
			t.Errorf("dest[%d]=%q, want %q", i, entries[i], n)
		}
	}

	// Re-running sync against the same intent must be a no-op: each
	// extracted file shares a stem with the source zip and matches via
	// alt-ext, so no copy and no delete.
	plan2, err := ComputeSync(intended, sourceFiles, dst, allowedExts)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan2.ToCopy) != 0 || len(plan2.ToDelete) != 0 {
		t.Errorf("expected no-op on second sync, got ToCopy=%v ToDelete=%v", plan2.ToCopy, plan2.ToDelete)
	}
}

func TestExecuteSync_NoExtractWhenFlagOff(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()
	zipPath := filepath.Join(src, "Game.zip")
	makeZip(t, zipPath, map[string]string{"rom.bin": "x"})

	plan := SyncPlan{ToCopy: []string{"Game.zip"}}
	if err := ExecuteSync(src, dst, plan, false); err != nil {
		t.Fatal(err)
	}
	entries, _ := ListFiles(dst)
	if len(entries) != 1 || entries[0] != "Game.zip" {
		t.Errorf("dest=%v, want [Game.zip] (zip not extracted)", entries)
	}
}
