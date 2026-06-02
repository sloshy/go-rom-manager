package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Mapping pairs one or more source folders with a single destination
// folder, along with any manual prefix overrides. The set of "selected"
// files is derived at runtime from the destination directory's contents
// (intersected with the union of all sources) — it is intentionally not
// persisted here.
//
// SourcePaths is the ordered list of read-only source directories that
// feed the destination. The destination is reconciled against the union
// of all of them on sync; filenames are expected to be unique across the
// union (the editor enforces this). Always serialized as an array.
//
// PrimarySource is the source folder that the editor loads first. When
// empty, the first entry of SourcePaths is used. It is omitted from JSON
// when unset.
//
// SourcePath is the legacy single-source field. It is migrated into
// SourcePaths on load and cleared, so it never round-trips back to disk;
// older mappings.json files upgrade transparently on the next save.
//
// Preferences is an optional per-mapping override of the auto-select
// priority order. A nil pointer means "inherit the global preferences";
// a non-nil slice (even if empty) is treated as an explicit override.
//
// LowPriorityTags is an optional per-mapping override of the set of tags
// that demote a variant to "last resort" (a file carrying any of them is
// only selected when its game has no cleaner variant). Same nil/non-nil
// semantics as Preferences: nil inherits the global list, a non-nil slice
// (even empty, meaning "no low-priority tags") is an explicit override.
//
// AllowedExtensions is the list of dest-side file extensions that
// should be considered alt-format counterparts of a source file sharing
// the same basename — e.g. a source "Game.zip" and a dest "Game.rvz"
// with ".rvz" in the list count as the same file for sync purposes (no
// copy, no delete). Each entry is normalized to lowercase with a leading
// dot (e.g. ".rvz"). Always serialized as an array (possibly empty) so
// API consumers don't need to handle a missing field.
//
// ExtractArchives, when true, causes ExecuteSync to extract any .zip
// file from source into destDir instead of copying the .zip itself.
// Inner entries are extracted with their original basenames preserved
// (subdirectory structure is flattened). Alt-ext matching uses
// games.VariantKey, so a `.cue` and its `(Track N).bin` siblings all
// trace back to the source zip on the next sync; inner files whose
// names don't share a variant key with any source file show as orange
// "no source" extras and must be managed manually.
type Mapping struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	SourcePaths       []string          `json:"sourcePaths"`
	PrimarySource     string            `json:"primarySource,omitempty"`
	SourcePath        string            `json:"sourcePath,omitempty"` // legacy; migrated into SourcePaths on load
	DestPath          string            `json:"destPath"`
	ManualGroups      map[string]string `json:"manualGroups"`
	Preferences       *[]string         `json:"preferences,omitempty"`
	LowPriorityTags   *[]string         `json:"lowPriorityTags,omitempty"`
	AllowedExtensions []string          `json:"allowedExtensions"`
	ExtractArchives   bool              `json:"extractArchives"`
}

// Store persists the list of mappings and the global preferences list to
// a JSON file. All access is serialized through the embedded mutex;
// writes are atomic via temp+rename.
type Store struct {
	mu                    sync.Mutex
	path                  string
	mappings              []Mapping
	globalPreferences     *[]string
	globalLowPriorityTags *[]string
}

type storeFile struct {
	Mappings              []Mapping `json:"mappings"`
	GlobalPreferences     *[]string `json:"globalPreferences,omitempty"`
	GlobalLowPriorityTags *[]string `json:"globalLowPriorityTags,omitempty"`
}

// NewStore loads the JSON file at path (creating an empty store if the
// file does not yet exist) and returns a ready-to-use Store.
func NewStore(path string) (*Store, error) {
	s := &Store{path: path}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.mappings = nil
			s.globalPreferences = nil
			s.globalLowPriorityTags = nil
			return nil
		}
		return err
	}
	var wrapper storeFile
	if err := json.Unmarshal(data, &wrapper); err != nil {
		return fmt.Errorf("parse %s: %w", s.path, err)
	}
	s.mappings = wrapper.Mappings
	for i := range s.mappings {
		m := &s.mappings[i]
		// Migrate the legacy single SourcePath into SourcePaths and clear
		// it so it never round-trips back to disk.
		if len(m.SourcePaths) == 0 && m.SourcePath != "" {
			m.SourcePaths = []string{m.SourcePath}
		}
		m.SourcePath = ""
		if m.SourcePaths == nil {
			m.SourcePaths = []string{}
		}
		if m.AllowedExtensions == nil {
			m.AllowedExtensions = []string{}
		}
		if m.ManualGroups == nil {
			m.ManualGroups = map[string]string{}
		}
	}
	s.globalPreferences = wrapper.GlobalPreferences
	s.globalLowPriorityTags = wrapper.GlobalLowPriorityTags
	return nil
}

func (s *Store) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	wrapper := storeFile{
		Mappings:              s.mappings,
		GlobalPreferences:     s.globalPreferences,
		GlobalLowPriorityTags: s.globalLowPriorityTags,
	}
	data, err := json.MarshalIndent(wrapper, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".mappings-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, s.path)
}

// All returns a copy of every mapping in the store.
func (s *Store) All() []Mapping {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Mapping, len(s.mappings))
	copy(out, s.mappings)
	return out
}

// Get returns the mapping with the given ID, or false if no such
// mapping exists.
func (s *Store) Get(id string) (Mapping, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.mappings {
		if m.ID == id {
			return m, true
		}
	}
	return Mapping{}, false
}

// Add inserts a new mapping, generating an ID for it. The provided
// mapping's ID field is ignored. Returns the inserted mapping.
func (s *Store) Add(m Mapping) (Mapping, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, err := newID()
	if err != nil {
		return Mapping{}, err
	}
	m.ID = id
	if m.ManualGroups == nil {
		m.ManualGroups = map[string]string{}
	}
	if m.AllowedExtensions == nil {
		m.AllowedExtensions = []string{}
	}
	if m.SourcePaths == nil {
		m.SourcePaths = []string{}
	}
	s.mappings = append(s.mappings, m)
	if err := s.saveLocked(); err != nil {
		s.mappings = s.mappings[:len(s.mappings)-1]
		return Mapping{}, err
	}
	return m, nil
}

// Update replaces the mapping with the same ID. Returns false if no
// such mapping exists.
func (s *Store) Update(m Mapping) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.mappings {
		if s.mappings[i].ID == m.ID {
			prev := s.mappings[i]
			s.mappings[i] = m
			if err := s.saveLocked(); err != nil {
				s.mappings[i] = prev
				return false, err
			}
			return true, nil
		}
	}
	return false, nil
}

// SetMappingPreferences replaces the preferences override for the
// mapping with the given ID. Pass nil to clear the override (so the
// mapping inherits the global preferences). Returns false if no such
// mapping exists.
func (s *Store) SetMappingPreferences(id string, prefs *[]string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.mappings {
		if s.mappings[i].ID == id {
			prev := s.mappings[i].Preferences
			s.mappings[i].Preferences = prefs
			if err := s.saveLocked(); err != nil {
				s.mappings[i].Preferences = prev
				return false, err
			}
			return true, nil
		}
	}
	return false, nil
}

// SetMappingLowPriorityTags replaces the low-priority-tags override for
// the mapping with the given ID. Pass nil to clear the override (so the
// mapping inherits the global list). Returns false if no such mapping
// exists.
func (s *Store) SetMappingLowPriorityTags(id string, tags *[]string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.mappings {
		if s.mappings[i].ID == id {
			prev := s.mappings[i].LowPriorityTags
			s.mappings[i].LowPriorityTags = tags
			if err := s.saveLocked(); err != nil {
				s.mappings[i].LowPriorityTags = prev
				return false, err
			}
			return true, nil
		}
	}
	return false, nil
}

// Delete removes the mapping with the given ID. Returns false if no
// such mapping exists.
func (s *Store) Delete(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.mappings {
		if s.mappings[i].ID == id {
			prev := s.mappings
			s.mappings = append(s.mappings[:i], s.mappings[i+1:]...)
			if err := s.saveLocked(); err != nil {
				s.mappings = prev
				return false, err
			}
			return true, nil
		}
	}
	return false, nil
}

// GlobalPreferences returns a copy of the persisted global preferences
// list, or nil if none has been set.
func (s *Store) GlobalPreferences() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.globalPreferences == nil {
		return nil
	}
	out := make([]string, len(*s.globalPreferences))
	copy(out, *s.globalPreferences)
	return out
}

// SetGlobalPreferences replaces the persisted global preferences list. An
// empty (non-nil) list is preserved as an explicit "no preferences" choice:
// the clone is always non-nil so it serializes as [] rather than null and
// therefore reloads as an empty override rather than reverting to defaults.
func (s *Store) SetGlobalPreferences(prefs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.globalPreferences
	clone := make([]string, len(prefs))
	copy(clone, prefs)
	s.globalPreferences = &clone
	if err := s.saveLocked(); err != nil {
		s.globalPreferences = prev
		return err
	}
	return nil
}

// GlobalLowPriorityTags returns a copy of the persisted global
// low-priority-tags list, or nil if none has been set.
func (s *Store) GlobalLowPriorityTags() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.globalLowPriorityTags == nil {
		return nil
	}
	out := make([]string, len(*s.globalLowPriorityTags))
	copy(out, *s.globalLowPriorityTags)
	return out
}

// SetGlobalLowPriorityTags replaces the persisted global low-priority-tags
// list. An empty (non-nil) list is preserved as an explicit "demote
// nothing" choice: the clone is always non-nil so it serializes as []
// rather than null and reloads as an empty override rather than reverting
// to the default low-priority tags.
func (s *Store) SetGlobalLowPriorityTags(tags []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.globalLowPriorityTags
	clone := make([]string, len(tags))
	copy(clone, tags)
	s.globalLowPriorityTags = &clone
	if err := s.saveLocked(); err != nil {
		s.globalLowPriorityTags = prev
		return err
	}
	return nil
}

func newID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
