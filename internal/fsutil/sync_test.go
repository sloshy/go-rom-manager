package fsutil

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestComputeSync_DiffsCorrectly(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game 1 (USA).zip"), "a")
	writeFile(t, filepath.Join(dir, "extras.txt"), "b")

	intended := []string{"Example Game 1 (USA).zip", "Example Game 2 (USA).zip"}
	sourceFiles := []string{"Example Game 1 (USA).zip", "Example Game 2 (USA).zip"}

	plan, err := ComputeSync(intended, sourceFiles, dir)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(plan.ToCopy)
	sort.Strings(plan.ToDelete)

	if len(plan.ToCopy) != 1 || plan.ToCopy[0] != "Example Game 2 (USA).zip" {
		t.Errorf("ToCopy=%v, want [Example Game 2 (USA).zip]", plan.ToCopy)
	}
	if len(plan.ToDelete) != 0 {
		t.Errorf("ToDelete=%v, want empty (extras.txt has no source counterpart)", plan.ToDelete)
	}
}

func TestComputeSync_DeletesDeselectedFilesWithSourceCounterpart(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game 1 (USA).zip"), "a")
	writeFile(t, filepath.Join(dir, "Example Game 2 (USA).zip"), "b")

	intended := []string{"Example Game 1 (USA).zip"}
	sourceFiles := []string{"Example Game 1 (USA).zip", "Example Game 2 (USA).zip"}

	plan, err := ComputeSync(intended, sourceFiles, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 0 {
		t.Errorf("ToCopy=%v, want none", plan.ToCopy)
	}
	if len(plan.ToDelete) != 1 || plan.ToDelete[0] != "Example Game 2 (USA).zip" {
		t.Errorf("ToDelete=%v, want [Example Game 2 (USA).zip]", plan.ToDelete)
	}
}

func TestComputeSync_PreservesFilesWithoutSourceCounterpart(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game 1 (USA).zip"), "a")
	writeFile(t, filepath.Join(dir, "out_of_band.txt"), "x")
	writeFile(t, filepath.Join(dir, "another_orphan.bin"), "y")

	intended := []string{"Example Game 1 (USA).zip"}
	sourceFiles := []string{"Example Game 1 (USA).zip"}

	plan, err := ComputeSync(intended, sourceFiles, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToDelete) != 0 {
		t.Errorf("ToDelete=%v, want empty (orange files must persist)", plan.ToDelete)
	}
}

func TestComputeSync_NonExistentDestTreatedAsEmpty(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing")
	plan, err := ComputeSync(
		[]string{"Example Game 1 (USA).zip"},
		[]string{"Example Game 1 (USA).zip"},
		dir,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 1 {
		t.Errorf("ToCopy=%v, want 1 entry", plan.ToCopy)
	}
}

func TestExecuteSync_CopiesAndDeletes(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()

	writeFile(t, filepath.Join(src, "Example Game 1 (USA).zip"), "rom1")
	writeFile(t, filepath.Join(src, "Example Game 2 (USA).zip"), "rom2")
	writeFile(t, filepath.Join(dst, "stale.zip"), "old")

	plan := SyncPlan{
		ToCopy:   []string{"Example Game 1 (USA).zip", "Example Game 2 (USA).zip"},
		ToDelete: []string{"stale.zip"},
	}
	if err := ExecuteSync(src, dst, plan); err != nil {
		t.Fatal(err)
	}

	got, err := ListFiles(dst)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Example Game 1 (USA).zip", "Example Game 2 (USA).zip"}
	if len(got) != len(want) {
		t.Fatalf("dest contents=%v, want %v", got, want)
	}
	for i, n := range want {
		if got[i] != n {
			t.Errorf("dest[%d]=%q, want %q", i, got[i], n)
		}
	}

	contents, _ := os.ReadFile(filepath.Join(dst, "Example Game 1 (USA).zip"))
	if string(contents) != "rom1" {
		t.Errorf("copied content=%q, want %q", contents, "rom1")
	}
}

func TestExecuteSync_DoesNotMutateSource(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()
	writeFile(t, filepath.Join(src, "Example Game 1 (USA).zip"), "rom1")

	srcInfoBefore, _ := os.Stat(filepath.Join(src, "Example Game 1 (USA).zip"))
	srcEntriesBefore, _ := ListFiles(src)

	plan := SyncPlan{ToCopy: []string{"Example Game 1 (USA).zip"}}
	if err := ExecuteSync(src, dst, plan); err != nil {
		t.Fatal(err)
	}

	srcInfoAfter, _ := os.Stat(filepath.Join(src, "Example Game 1 (USA).zip"))
	srcEntriesAfter, _ := ListFiles(src)

	if srcInfoBefore.ModTime() != srcInfoAfter.ModTime() {
		t.Errorf("source file mtime changed")
	}
	if len(srcEntriesBefore) != len(srcEntriesAfter) {
		t.Errorf("source entry count changed: before=%v after=%v", srcEntriesBefore, srcEntriesAfter)
	}
}

func TestEnsureUnderRoot(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "snes")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := EnsureUnderRoot(sub, []string{root}); err != nil {
		t.Errorf("legitimate sub rejected: %v", err)
	}
	outside := t.TempDir()
	if _, err := EnsureUnderRoot(outside, []string{root}); err == nil {
		t.Errorf("outside path was accepted")
	}
	traversal := filepath.Join(root, "..", filepath.Base(root)+"-sibling")
	if _, err := EnsureUnderRoot(traversal, []string{root}); err == nil {
		t.Errorf("traversal path was accepted")
	}
}

func TestBrowse(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "snes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "genesis"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "readme.txt"), "")

	entries, err := Browse(root, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("want 3 entries, got %v", entries)
	}
	if !entries[0].IsDir || !entries[1].IsDir || entries[2].IsDir {
		t.Errorf("expected dirs first, got %v", entries)
	}
	if entries[0].Name != "genesis" || entries[1].Name != "snes" {
		t.Errorf("expected alphabetical dirs, got %v", entries)
	}
}
