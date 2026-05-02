package config

import (
	"os"
	"path/filepath"
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
