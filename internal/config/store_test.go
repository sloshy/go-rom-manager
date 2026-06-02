package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStore_AddGetAll(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")

	s, err := NewStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.All(); len(got) != 0 {
		t.Errorf("fresh store should be empty, got %v", got)
	}

	added, err := s.Add(Mapping{Name: "Console A", SourcePath: "/src/console-a", DestPath: "/dst/console-a"})
	if err != nil {
		t.Fatal(err)
	}
	if added.ID == "" {
		t.Errorf("Add should generate an ID")
	}

	got, ok := s.Get(added.ID)
	if !ok || got.Name != "Console A" {
		t.Errorf("Get(%q) = (%v, %v)", added.ID, got, ok)
	}

	all := s.All()
	if len(all) != 1 {
		t.Errorf("All() = %v, want 1 entry", all)
	}
}

func TestStore_PersistsAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")

	s1, _ := NewStore(storePath)
	added, err := s1.Add(Mapping{Name: "Console B", SourcePath: "/src/console-b", DestPath: "/dst/console-b"})
	if err != nil {
		t.Fatal(err)
	}

	s2, err := NewStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := s2.Get(added.ID)
	if !ok || got.Name != "Console B" {
		t.Errorf("reloaded store missing the mapping; got=(%v, %v)", got, ok)
	}
}

func TestStore_UpdateAndDelete(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)
	added, _ := s.Add(Mapping{Name: "A", SourcePath: "/s/a", DestPath: "/d/a"})

	added.Name = "A-renamed"
	added.ManualGroups = map[string]string{
		"Example Game 1 (Japan).zip": "Example Group A",
	}
	ok, err := s.Update(added)
	if err != nil || !ok {
		t.Fatalf("Update returned (%v, %v)", ok, err)
	}
	got, _ := s.Get(added.ID)
	if got.Name != "A-renamed" || got.ManualGroups["Example Game 1 (Japan).zip"] != "Example Group A" {
		t.Errorf("Update didn't persist changes, got %+v", got)
	}

	deleted, err := s.Delete(added.ID)
	if err != nil || !deleted {
		t.Fatalf("Delete returned (%v, %v)", deleted, err)
	}
	if _, ok := s.Get(added.ID); ok {
		t.Errorf("entry still present after Delete")
	}
}

func TestStore_GlobalPreferencesPersist(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)

	if got := s.GlobalPreferences(); got != nil {
		t.Errorf("fresh store GlobalPreferences = %v, want nil", got)
	}
	if err := s.SetGlobalPreferences([]string{"Japan", "USA"}); err != nil {
		t.Fatal(err)
	}

	s2, err := NewStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	got := s2.GlobalPreferences()
	if len(got) != 2 || got[0] != "Japan" || got[1] != "USA" {
		t.Errorf("reloaded GlobalPreferences = %v, want [Japan USA]", got)
	}
}

func TestStore_SetMappingPreferences(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)
	added, _ := s.Add(Mapping{Name: "A", SourcePath: "/s", DestPath: "/d"})

	override := []string{"Europe"}
	ok, err := s.SetMappingPreferences(added.ID, &override)
	if err != nil || !ok {
		t.Fatalf("SetMappingPreferences = (%v, %v)", ok, err)
	}
	got, _ := s.Get(added.ID)
	if got.Preferences == nil || (*got.Preferences)[0] != "Europe" {
		t.Errorf("override not persisted, got %+v", got.Preferences)
	}

	// Clearing the override puts the mapping back to inheriting global prefs.
	if _, err := s.SetMappingPreferences(added.ID, nil); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(added.ID)
	if got.Preferences != nil {
		t.Errorf("expected nil preferences after clear, got %+v", got.Preferences)
	}
}

func TestStore_GlobalLowPriorityTagsPersist(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)

	if got := s.GlobalLowPriorityTags(); got != nil {
		t.Errorf("fresh store GlobalLowPriorityTags = %v, want nil", got)
	}
	if err := s.SetGlobalLowPriorityTags([]string{"Demo", "Sample"}); err != nil {
		t.Fatal(err)
	}

	s2, err := NewStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	got := s2.GlobalLowPriorityTags()
	if len(got) != 2 || got[0] != "Demo" || got[1] != "Sample" {
		t.Errorf("reloaded GlobalLowPriorityTags = %v, want [Demo Sample]", got)
	}
}

// An explicit empty global list ("demote nothing") must survive a reload as
// a non-nil empty override rather than reverting to the default tags.
func TestStore_EmptyGlobalLowPriorityTagsRoundTrips(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)

	if err := s.SetGlobalLowPriorityTags([]string{}); err != nil {
		t.Fatal(err)
	}

	s2, err := NewStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	got := s2.GlobalLowPriorityTags()
	if got == nil {
		t.Fatal("reloaded empty GlobalLowPriorityTags = nil (reverted to inherit/default), want non-nil empty")
	}
	if len(got) != 0 {
		t.Errorf("reloaded GlobalLowPriorityTags = %v, want empty", got)
	}
}

func TestStore_SetMappingLowPriorityTags(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)
	added, _ := s.Add(Mapping{Name: "A", SourcePath: "/s", DestPath: "/d"})

	override := []string{"Beta"}
	ok, err := s.SetMappingLowPriorityTags(added.ID, &override)
	if err != nil || !ok {
		t.Fatalf("SetMappingLowPriorityTags = (%v, %v)", ok, err)
	}
	got, _ := s.Get(added.ID)
	if got.LowPriorityTags == nil || (*got.LowPriorityTags)[0] != "Beta" {
		t.Errorf("override not persisted, got %+v", got.LowPriorityTags)
	}

	// Clearing the override puts the mapping back to inheriting the global list.
	if _, err := s.SetMappingLowPriorityTags(added.ID, nil); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(added.ID)
	if got.LowPriorityTags != nil {
		t.Errorf("expected nil low-priority tags after clear, got %+v", got.LowPriorityTags)
	}
}

func TestStore_ExtractArchivesPersists(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)
	added, _ := s.Add(Mapping{Name: "A", SourcePath: "/s", DestPath: "/d"})

	if got, _ := s.Get(added.ID); got.ExtractArchives {
		t.Errorf("default ExtractArchives should be false, got true")
	}

	added.ExtractArchives = true
	if _, err := s.Update(added); err != nil {
		t.Fatal(err)
	}

	s2, err := NewStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s2.Get(added.ID)
	if !got.ExtractArchives {
		t.Errorf("ExtractArchives didn't persist across reloads, got %+v", got)
	}
}

func TestStore_MigratesLegacySourcePath(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")

	// A legacy mappings.json written before multi-source support: a single
	// "sourcePath" field and no "sourcePaths".
	legacy := `{
	  "mappings": [
	    { "id": "abc", "name": "Legacy", "sourcePath": "/src/legacy", "destPath": "/dst/legacy" }
	  ]
	}`
	if err := os.WriteFile(storePath, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	s, err := NewStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := s.Get("abc")
	if !ok {
		t.Fatal("legacy mapping not loaded")
	}
	if len(got.SourcePaths) != 1 || got.SourcePaths[0] != "/src/legacy" {
		t.Errorf("SourcePaths=%v, want [/src/legacy] migrated from sourcePath", got.SourcePaths)
	}
	if got.SourcePath != "" {
		t.Errorf("legacy SourcePath should be cleared after migration, got %q", got.SourcePath)
	}

	// Saving must drop the legacy field entirely (omitempty + cleared).
	if _, err := s.Update(got); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(storePath)
	if strings.Contains(string(data), "\"sourcePath\"") {
		t.Errorf("persisted JSON should not contain the legacy sourcePath field:\n%s", data)
	}
}

func TestStore_AtomicWrite(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "mappings.json")
	s, _ := NewStore(storePath)
	if _, err := s.Add(Mapping{Name: "X"}); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "mappings.json" {
		t.Errorf("expected only mappings.json in dir, got %v", entries)
	}
}
