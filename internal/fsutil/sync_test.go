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

// intend builds an intended file list, tagging each name with the given
// source directory. ComputeSync only reads the destination directory, so
// dir is irrelevant to its diff logic and may be empty for those tests;
// it matters only for ExecuteSync, which copies from each file's dir.
func intend(dir string, names ...string) []SourceFile {
	out := make([]SourceFile, len(names))
	for i, n := range names {
		out[i] = SourceFile{Name: n, Dir: dir}
	}
	return out
}

// copyNames extracts the basenames of a plan's ToCopy entries for
// order-independent assertions.
func copyNames(plan SyncPlan) []string {
	out := make([]string, len(plan.ToCopy))
	for i, f := range plan.ToCopy {
		out[i] = f.Name
	}
	return out
}

func TestComputeSync_DiffsCorrectly(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game 1 (USA).zip"), "a")
	writeFile(t, filepath.Join(dir, "extras.txt"), "b")

	intended := intend("", "Example Game 1 (USA).zip", "Example Game 2 (USA).zip")
	sourceFiles := []string{"Example Game 1 (USA).zip", "Example Game 2 (USA).zip"}

	plan, err := ComputeSync(intended, sourceFiles, dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	toCopy := copyNames(plan)
	sort.Strings(toCopy)
	sort.Strings(plan.ToDelete)

	if len(toCopy) != 1 || toCopy[0] != "Example Game 2 (USA).zip" {
		t.Errorf("ToCopy=%v, want [Example Game 2 (USA).zip]", toCopy)
	}
	if len(plan.ToDelete) != 0 {
		t.Errorf("ToDelete=%v, want empty (extras.txt has no source counterpart)", plan.ToDelete)
	}
}

func TestComputeSync_DeletesDeselectedFilesWithSourceCounterpart(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game 1 (USA).zip"), "a")
	writeFile(t, filepath.Join(dir, "Example Game 2 (USA).zip"), "b")

	intended := intend("", "Example Game 1 (USA).zip")
	sourceFiles := []string{"Example Game 1 (USA).zip", "Example Game 2 (USA).zip"}

	plan, err := ComputeSync(intended, sourceFiles, dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 0 {
		t.Errorf("ToCopy=%v, want none", copyNames(plan))
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

	intended := intend("", "Example Game 1 (USA).zip")
	sourceFiles := []string{"Example Game 1 (USA).zip"}

	plan, err := ComputeSync(intended, sourceFiles, dir, nil)
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
		intend("", "Example Game 1 (USA).zip"),
		[]string{"Example Game 1 (USA).zip"},
		dir,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 1 {
		t.Errorf("ToCopy=%v, want 1 entry", copyNames(plan))
	}
}

func TestComputeSync_UnionAcrossSources(t *testing.T) {
	// Two intended files come from two different source directories. Both
	// must be queued for copy and each ToCopy entry must carry the dir it
	// came from so ExecuteSync copies from the right place.
	dir := t.TempDir()
	srcA := "/sources/a"
	srcB := "/sources/b"

	intended := []SourceFile{
		{Name: "Example Game 1 (USA).zip", Dir: srcA},
		{Name: "Example Game 2 (Japan).zip", Dir: srcB},
	}
	// Union of both source directories.
	sourceFiles := []string{"Example Game 1 (USA).zip", "Example Game 2 (Japan).zip"}

	plan, err := ComputeSync(intended, sourceFiles, dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 2 {
		t.Fatalf("ToCopy=%v, want 2 entries", plan.ToCopy)
	}
	gotDir := map[string]string{}
	for _, f := range plan.ToCopy {
		gotDir[f.Name] = f.Dir
	}
	if gotDir["Example Game 1 (USA).zip"] != srcA {
		t.Errorf("Game 1 dir=%q, want %q", gotDir["Example Game 1 (USA).zip"], srcA)
	}
	if gotDir["Example Game 2 (Japan).zip"] != srcB {
		t.Errorf("Game 2 dir=%q, want %q", gotDir["Example Game 2 (Japan).zip"], srcB)
	}
}

func TestComputeSync_AltExtSatisfiesIntent(t *testing.T) {
	// Source has Example Game.zip; dest has Example Game.rvz (a converted version).
	// With ".rvz" allowed, the sync must treat them as the same file:
	// no copy of Example Game.zip, no deletion of Example Game.rvz.
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game.rvz"), "rvz")

	plan, err := ComputeSync(
		intend("", "Example Game.zip"),
		[]string{"Example Game.zip"},
		dir,
		[]string{".rvz"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 0 {
		t.Errorf("ToCopy=%v, want empty (Example Game.rvz already satisfies)", copyNames(plan))
	}
	if len(plan.ToDelete) != 0 {
		t.Errorf("ToDelete=%v, want empty (Example Game.rvz alt-ext matches Example Game.zip)", plan.ToDelete)
	}
}

func TestComputeSync_AltExtDeselectionDeletes(t *testing.T) {
	// Example Game.rvz on disk, but the user has deselected the game entirely
	// (intended is empty). Example Game.rvz is now managed via alt-ext, so it
	// should be deleted.
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game.rvz"), "rvz")

	plan, err := ComputeSync(
		nil,
		[]string{"Example Game.zip"},
		dir,
		[]string{".rvz"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToDelete) != 1 || plan.ToDelete[0] != "Example Game.rvz" {
		t.Errorf("ToDelete=%v, want [Example Game.rvz]", plan.ToDelete)
	}
}

func TestComputeSync_AltExtUnknownExtIsOrange(t *testing.T) {
	// Example Game.cso has no source counterpart by name and ".cso" is NOT in
	// the allowed list, so it must remain untouched (orange).
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game.cso"), "cso")

	plan, err := ComputeSync(
		nil,
		[]string{"Example Game.zip"},
		dir,
		[]string{".rvz"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToDelete) != 0 {
		t.Errorf("ToDelete=%v, want empty (.cso not in allowed list)", plan.ToDelete)
	}
}

func TestComputeSync_AltExtCaseInsensitive(t *testing.T) {
	// Allowed list is normalized lowercase but the file on disk has
	// uppercase extension — they should still match.
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Example Game.RVZ"), "rvz")

	plan, err := ComputeSync(
		intend("", "Example Game.zip"),
		[]string{"Example Game.zip"},
		dir,
		[]string{".rvz"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 0 || len(plan.ToDelete) != 0 {
		t.Errorf("expected no-op, got ToCopy=%v ToDelete=%v", copyNames(plan), plan.ToDelete)
	}
}

func TestComputeSync_AltExtVariantKeyMatchesMultiTrackFiles(t *testing.T) {
	// Source is a single zip; dest has the cue + multiple bin files
	// extracted from it. Their stems differ ("Game" vs "Game (Track 1)")
	// but their VariantKey is the same ("Game"), so alt-ext matching
	// must treat all three as managed by the source zip — no re-copy,
	// no spurious deletion of the bins.
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Game.cue"), "cue")
	writeFile(t, filepath.Join(dir, "Game (Track 1).bin"), "b1")
	writeFile(t, filepath.Join(dir, "Game (Track 2).bin"), "b2")

	plan, err := ComputeSync(
		intend("", "Game.zip"),
		[]string{"Game.zip"},
		dir,
		[]string{".bin", ".cue"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 0 {
		t.Errorf("ToCopy=%v, want empty (variant-key match should satisfy intent)", copyNames(plan))
	}
	if len(plan.ToDelete) != 0 {
		t.Errorf("ToDelete=%v, want empty (track files share VariantKey with source zip)", plan.ToDelete)
	}
}

func TestComputeSync_AltExtVariantKeyDeleteOnDeselect(t *testing.T) {
	// Same setup, but the user has deselected the game. Every dest file
	// shares VariantKey with the source zip, so all three are "managed"
	// and should be queued for deletion.
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Game.cue"), "cue")
	writeFile(t, filepath.Join(dir, "Game (Track 1).bin"), "b1")
	writeFile(t, filepath.Join(dir, "Game (Track 2).bin"), "b2")

	plan, err := ComputeSync(
		nil,
		[]string{"Game.zip"},
		dir,
		[]string{".bin", ".cue"},
	)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(plan.ToDelete)
	want := []string{"Game (Track 1).bin", "Game (Track 2).bin", "Game.cue"}
	if len(plan.ToDelete) != len(want) {
		t.Fatalf("ToDelete=%v, want %v", plan.ToDelete, want)
	}
	for i, n := range want {
		if plan.ToDelete[i] != n {
			t.Errorf("ToDelete[%d]=%q, want %q", i, plan.ToDelete[i], n)
		}
	}
}

func TestComputeSync_DifferentDiscsRemainDistinct(t *testing.T) {
	// (Disc N) is NOT a variant-part marker — it must keep different
	// discs as separate variants. Intent is Disc 1 only; Disc 2 files
	// in dest must be deleted as managed-but-not-intended.
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Game (Disc 1).cue"), "1c")
	writeFile(t, filepath.Join(dir, "Game (Disc 1) (Track 1).bin"), "1b")
	writeFile(t, filepath.Join(dir, "Game (Disc 2).cue"), "2c")
	writeFile(t, filepath.Join(dir, "Game (Disc 2) (Track 1).bin"), "2b")

	plan, err := ComputeSync(
		intend("", "Game (Disc 1).zip"),
		[]string{"Game (Disc 1).zip", "Game (Disc 2).zip"},
		dir,
		[]string{".bin", ".cue"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.ToCopy) != 0 {
		t.Errorf("ToCopy=%v, want empty (disc 1 is satisfied by alt-ext)", copyNames(plan))
	}
	sort.Strings(plan.ToDelete)
	want := []string{"Game (Disc 2) (Track 1).bin", "Game (Disc 2).cue"}
	if len(plan.ToDelete) != len(want) {
		t.Fatalf("ToDelete=%v, want %v", plan.ToDelete, want)
	}
	for i, n := range want {
		if plan.ToDelete[i] != n {
			t.Errorf("ToDelete[%d]=%q, want %q", i, plan.ToDelete[i], n)
		}
	}
}

func TestExecuteSync_CopiesAndDeletes(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()

	writeFile(t, filepath.Join(src, "Example Game 1 (USA).zip"), "rom1")
	writeFile(t, filepath.Join(src, "Example Game 2 (USA).zip"), "rom2")
	writeFile(t, filepath.Join(dst, "stale.zip"), "old")

	plan := SyncPlan{
		ToCopy:   intend(src, "Example Game 1 (USA).zip", "Example Game 2 (USA).zip"),
		ToDelete: []string{"stale.zip"},
	}
	if err := ExecuteSync(dst, plan, false); err != nil {
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

func TestExecuteSync_CopiesFromPerFileDir(t *testing.T) {
	// Each ToCopy entry names its own source directory — ExecuteSync must
	// copy each file from the dir it carries, not from a single shared one.
	srcA := t.TempDir()
	srcB := t.TempDir()
	dst := t.TempDir()
	writeFile(t, filepath.Join(srcA, "From A.zip"), "a-content")
	writeFile(t, filepath.Join(srcB, "From B.zip"), "b-content")

	plan := SyncPlan{
		ToCopy: []SourceFile{
			{Name: "From A.zip", Dir: srcA},
			{Name: "From B.zip", Dir: srcB},
		},
	}
	if err := ExecuteSync(dst, plan, false); err != nil {
		t.Fatal(err)
	}

	a, _ := os.ReadFile(filepath.Join(dst, "From A.zip"))
	b, _ := os.ReadFile(filepath.Join(dst, "From B.zip"))
	if string(a) != "a-content" {
		t.Errorf("From A.zip content=%q, want %q", a, "a-content")
	}
	if string(b) != "b-content" {
		t.Errorf("From B.zip content=%q, want %q", b, "b-content")
	}
}

func TestExecuteSync_DoesNotMutateSource(t *testing.T) {
	src := t.TempDir()
	dst := t.TempDir()
	writeFile(t, filepath.Join(src, "Example Game 1 (USA).zip"), "rom1")

	srcInfoBefore, _ := os.Stat(filepath.Join(src, "Example Game 1 (USA).zip"))
	srcEntriesBefore, _ := ListFiles(src)

	plan := SyncPlan{ToCopy: intend(src, "Example Game 1 (USA).zip")}
	if err := ExecuteSync(dst, plan, false); err != nil {
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
