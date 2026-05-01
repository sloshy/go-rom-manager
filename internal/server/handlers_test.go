package server

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"testing/fstest"

	"github.com/slosh/go-rom-manager/internal/config"
)

func setupTestServer(t *testing.T) (*httptest.Server, string, string, *config.Store) {
	t.Helper()
	srcRoot := t.TempDir()
	dstRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(srcRoot, "snes"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{
		"Example Game 1 (USA).zip",
		"Example Game 1 (Japan).zip",
		"Example Game 2 (World) (Rev 1).zip",
		"Example Game 2 (World) (Rev 2).zip",
		"Example Game 2 (USA) (Demo).zip",
	} {
		if err := os.WriteFile(filepath.Join(srcRoot, "snes", f), []byte(f), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	cfg := &config.AppConfig{Sources: []string{srcRoot}, Dests: []string{dstRoot}}
	store, err := config.NewStore(filepath.Join(t.TempDir(), "mappings.json"))
	if err != nil {
		t.Fatal(err)
	}

	stubFS := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html></html>")}}
	srv := New(cfg, store, fs.FS(stubFS))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, srcRoot, dstRoot, store
}

func TestHandleGetConfig(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)
	resp, err := http.Get(ts.URL + "/api/config")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var got struct {
		Sources []string `json:"sources"`
		Dests   []string `json:"dests"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Sources) != 1 || got.Sources[0] != srcRoot {
		t.Errorf("Sources=%v, want [%q]", got.Sources, srcRoot)
	}
	if len(got.Dests) != 1 || got.Dests[0] != dstRoot {
		t.Errorf("Dests=%v, want [%q]", got.Dests, dstRoot)
	}
}

func TestHandleBrowse(t *testing.T) {
	ts, srcRoot, _, _ := setupTestServer(t)
	resp, err := http.Get(ts.URL + "/api/browse?root=" + srcRoot)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var got struct {
		Path    string `json:"path"`
		Entries []struct {
			Name  string `json:"name"`
			IsDir bool   `json:"isDir"`
		} `json:"entries"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Entries) != 1 || got.Entries[0].Name != "snes" || !got.Entries[0].IsDir {
		t.Errorf("Browse entries=%v, want [snes/]", got.Entries)
	}
}

func TestHandleCreateMapping_Validates(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	body, _ := json.Marshal(map[string]string{
		"name":       "SNES",
		"sourcePath": filepath.Join(srcRoot, "snes"),
		"destPath":   dstRoot,
	})
	resp, err := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d, want 201", resp.StatusCode)
	}

	rejected, _ := json.Marshal(map[string]string{
		"name":       "Bad",
		"sourcePath": "/etc",
		"destPath":   dstRoot,
	})
	bad, err := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(rejected))
	if err != nil {
		t.Fatal(err)
	}
	defer bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for outside-root path, got %d", bad.StatusCode)
	}
}

func TestEndToEnd_CreateSelectSync(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	body, _ := json.Marshal(map[string]string{
		"name":       "SNES",
		"sourcePath": filepath.Join(srcRoot, "snes"),
		"destPath":   dstRoot,
	})
	resp, _ := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(body))
	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	if created.ID == "" {
		t.Fatal("expected created mapping ID")
	}

	syncBody, _ := json.Marshal(map[string]any{
		"intended": []string{
			"Example Game 1 (USA).zip",
			"Example Game 2 (World) (Rev 2).zip",
		},
	})
	syncResp, err := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync",
		"application/json", bytes.NewReader(syncBody))
	if err != nil {
		t.Fatal(err)
	}
	defer syncResp.Body.Close()
	if syncResp.StatusCode != http.StatusOK {
		t.Fatalf("sync status=%d", syncResp.StatusCode)
	}

	entries, err := os.ReadDir(dstRoot)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, len(entries))
	for i, e := range entries {
		names[i] = e.Name()
	}
	sort.Strings(names)
	want := []string{"Example Game 1 (USA).zip", "Example Game 2 (World) (Rev 2).zip"}
	if len(names) != len(want) || names[0] != want[0] || names[1] != want[1] {
		t.Errorf("dest contents=%v, want %v", names, want)
	}
}

func TestEndToEnd_RedDeletes_OrangeStays(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	// Drop an out-of-band "orange" file directly in the destination
	// before any sync — it must survive every subsequent sync.
	orphan := filepath.Join(dstRoot, "out_of_band.txt")
	if err := os.WriteFile(orphan, []byte("never managed"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{
		"name":       "SNES",
		"sourcePath": filepath.Join(srcRoot, "snes"),
		"destPath":   dstRoot,
	})
	resp, _ := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(body))
	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	// First sync: select two files. Both should be copied; orphan untouched.
	firstSync, _ := json.Marshal(map[string]any{
		"intended": []string{
			"Example Game 1 (USA).zip",
			"Example Game 2 (World) (Rev 2).zip",
		},
	})
	if r, _ := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync",
		"application/json", bytes.NewReader(firstSync)); r.StatusCode != http.StatusOK {
		t.Fatalf("first sync status=%d", r.StatusCode)
	}
	if _, err := os.Stat(orphan); err != nil {
		t.Errorf("out-of-band file removed by first sync: %v", err)
	}

	// Second sync: deselect Game 2. Game 2 has a source counterpart and is
	// no longer intended → must be deleted (red). The orphan has no source
	// counterpart so it must still survive.
	secondSync, _ := json.Marshal(map[string]any{
		"intended": []string{"Example Game 1 (USA).zip"},
	})
	r2, _ := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync",
		"application/json", bytes.NewReader(secondSync))
	defer r2.Body.Close()
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("second sync status=%d", r2.StatusCode)
	}
	var result struct {
		Copied  []string `json:"copied"`
		Deleted []string `json:"deleted"`
	}
	json.NewDecoder(r2.Body).Decode(&result)
	if len(result.Deleted) != 1 || result.Deleted[0] != "Example Game 2 (World) (Rev 2).zip" {
		t.Errorf("Deleted=%v, want [Example Game 2 (World) (Rev 2).zip]", result.Deleted)
	}
	if _, err := os.Stat(orphan); err != nil {
		t.Errorf("out-of-band file removed by second sync: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dstRoot, "Example Game 2 (World) (Rev 2).zip")); !os.IsNotExist(err) {
		t.Errorf("deselected file should have been removed, got err=%v", err)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)

	resp, err := http.Get(ts.URL + "/api/settings")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var initial struct {
		Preferences        []string `json:"preferences"`
		DefaultPreferences []string `json:"defaultPreferences"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&initial); err != nil {
		t.Fatal(err)
	}
	if len(initial.Preferences) != 2 || initial.Preferences[0] != "USA" || initial.Preferences[1] != "World" {
		t.Errorf("default preferences = %v, want [USA World]", initial.Preferences)
	}
	if len(initial.DefaultPreferences) == 0 {
		t.Error("expected defaultPreferences hint to be populated")
	}

	body, _ := json.Marshal(map[string]any{"preferences": []string{" Japan ", "Europe", ""}})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	put, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer put.Body.Close()
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT settings status=%d", put.StatusCode)
	}

	resp2, _ := http.Get(ts.URL + "/api/settings")
	defer resp2.Body.Close()
	var after struct {
		Preferences []string `json:"preferences"`
	}
	json.NewDecoder(resp2.Body).Decode(&after)
	if len(after.Preferences) != 2 || after.Preferences[0] != "Japan" || after.Preferences[1] != "Europe" {
		t.Errorf("after PUT got %v, want [Japan Europe] (trimmed/dropped empty)", after.Preferences)
	}
}

func TestSettings_RejectsDuplicates(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)
	body, _ := json.Marshal(map[string]any{"preferences": []string{"USA", "usa"}})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 on case-insensitive duplicate, got %d", resp.StatusCode)
	}
}

func TestMappingPreferences_OverrideAndInherit(t *testing.T) {
	ts, srcRoot, dstRoot, store := setupTestServer(t)

	created, err := store.Add(config.Mapping{
		Name:       "SNES",
		SourcePath: filepath.Join(srcRoot, "snes"),
		DestPath:   dstRoot,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Set a global preference so we can tell inheritance apart.
	body, _ := json.Marshal(map[string]any{"preferences": []string{"Japan"}})
	r, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/settings", bytes.NewReader(body))
	if got, _ := http.DefaultClient.Do(r); got.StatusCode != http.StatusOK {
		t.Fatalf("seed global prefs status=%d", got.StatusCode)
	}

	// Mapping with no override should inherit the global prefs.
	resp, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer resp.Body.Close()
	var detail struct {
		Mapping              config.Mapping `json:"mapping"`
		EffectivePreferences []string       `json:"effectivePreferences"`
	}
	json.NewDecoder(resp.Body).Decode(&detail)
	if detail.Mapping.Preferences != nil {
		t.Errorf("expected nil per-mapping override, got %v", detail.Mapping.Preferences)
	}
	if len(detail.EffectivePreferences) != 1 || detail.EffectivePreferences[0] != "Japan" {
		t.Errorf("effective prefs = %v, want [Japan] inherited from global", detail.EffectivePreferences)
	}

	// Setting a per-mapping override wins over the global.
	overrideBody, _ := json.Marshal(map[string]any{"preferences": []string{"Europe"}})
	pReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID+"/preferences", bytes.NewReader(overrideBody))
	pReq.Header.Set("Content-Type", "application/json")
	pResp, _ := http.DefaultClient.Do(pReq)
	defer pResp.Body.Close()
	if pResp.StatusCode != http.StatusOK {
		t.Fatalf("PUT mapping prefs status=%d", pResp.StatusCode)
	}

	resp2, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer resp2.Body.Close()
	json.NewDecoder(resp2.Body).Decode(&detail)
	if detail.Mapping.Preferences == nil || (*detail.Mapping.Preferences)[0] != "Europe" {
		t.Errorf("override not stored, got %+v", detail.Mapping.Preferences)
	}
	if len(detail.EffectivePreferences) != 1 || detail.EffectivePreferences[0] != "Europe" {
		t.Errorf("effective prefs = %v, want [Europe] from override", detail.EffectivePreferences)
	}

	// Clearing (null) reverts the mapping to inheriting global.
	clearReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID+"/preferences",
		bytes.NewReader([]byte(`{"preferences":null}`)))
	clearReq.Header.Set("Content-Type", "application/json")
	cResp, _ := http.DefaultClient.Do(clearReq)
	defer cResp.Body.Close()
	if cResp.StatusCode != http.StatusOK {
		t.Fatalf("clear status=%d", cResp.StatusCode)
	}
	resp3, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer resp3.Body.Close()
	var afterClear struct {
		Mapping              config.Mapping `json:"mapping"`
		EffectivePreferences []string       `json:"effectivePreferences"`
	}
	json.NewDecoder(resp3.Body).Decode(&afterClear)
	if afterClear.Mapping.Preferences != nil {
		t.Errorf("expected cleared override, got %+v", afterClear.Mapping.Preferences)
	}
	if len(afterClear.EffectivePreferences) != 1 || afterClear.EffectivePreferences[0] != "Japan" {
		t.Errorf("effective prefs after clear = %v, want [Japan] (back to global)", afterClear.EffectivePreferences)
	}
}

func TestSPAFallback(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)
	resp, err := http.Get(ts.URL + "/some/spa/route")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("SPA fallback status=%d, want 200", resp.StatusCode)
	}
}
