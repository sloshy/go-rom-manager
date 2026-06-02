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

// intendedFiles builds the sync-request "intended" payload: each file
// name tagged with the source directory it should be copied from.
func intendedFiles(dir string, names ...string) []map[string]string {
	out := make([]map[string]string, len(names))
	for i, n := range names {
		out[i] = map[string]string{"name": n, "dir": dir}
	}
	return out
}

func setupTestServer(t *testing.T) (*httptest.Server, string, string, *config.Store) {
	t.Helper()
	srcRoot := t.TempDir()
	dstRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(srcRoot, "console-a"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{
		"Example Game 1 (USA).zip",
		"Example Game 1 (Japan).zip",
		"Example Game 2 (World) (Rev 1).zip",
		"Example Game 2 (World) (Rev 2).zip",
		"Example Game 2 (USA) (Demo).zip",
	} {
		if err := os.WriteFile(filepath.Join(srcRoot, "console-a", f), []byte(f), 0o644); err != nil {
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
	if len(got.Entries) != 1 || got.Entries[0].Name != "console-a" || !got.Entries[0].IsDir {
		t.Errorf("Browse entries=%v, want [console-a/]", got.Entries)
	}
}

func TestHandleGetLicenses(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)
	resp, err := http.Get(ts.URL + "/api/licenses")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got struct {
		Go []struct {
			Name    string `json:"name"`
			Version string `json:"version"`
			License string `json:"license"`
			Text    string `json:"text"`
		} `json:"go"`
		JS []struct {
			Name string `json:"name"`
		} `json:"js"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Go) == 0 {
		t.Fatalf("expected non-empty go list")
	}
	if got.Go[0].Name != "github.com/slosh/go-rom-manager" {
		t.Errorf("first go entry should be the project; got %q", got.Go[0].Name)
	}
	if got.Go[0].Text == "" {
		t.Errorf("project license text should be populated")
	}
}

func TestHandleCreateMapping_Validates(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	body, _ := json.Marshal(map[string]string{
		"name":       "Test Mapping",
		"sourcePath": filepath.Join(srcRoot, "console-a"),
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
		"name":       "Test Mapping",
		"sourcePath": filepath.Join(srcRoot, "console-a"),
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
		"intended": intendedFiles(filepath.Join(srcRoot, "console-a"),
			"Example Game 1 (USA).zip",
			"Example Game 2 (World) (Rev 2).zip",
		),
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
		"name":       "Test Mapping",
		"sourcePath": filepath.Join(srcRoot, "console-a"),
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
		"intended": intendedFiles(filepath.Join(srcRoot, "console-a"),
			"Example Game 1 (USA).zip",
			"Example Game 2 (World) (Rev 2).zip",
		),
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
		"intended": intendedFiles(filepath.Join(srcRoot, "console-a"), "Example Game 1 (USA).zip"),
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

func TestSettings_LowPriorityRoundTrip(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)

	resp, err := http.Get(ts.URL + "/api/settings")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var initial struct {
		Preferences            []string `json:"preferences"`
		LowPriorityTags        []string `json:"lowPriorityTags"`
		DefaultLowPriorityTags []string `json:"defaultLowPriorityTags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&initial); err != nil {
		t.Fatal(err)
	}
	if len(initial.LowPriorityTags) != 3 || initial.LowPriorityTags[0] != "Demo" ||
		initial.LowPriorityTags[1] != "Proto" || initial.LowPriorityTags[2] != "Sample" {
		t.Errorf("default lowPriorityTags = %v, want [Demo Proto Sample]", initial.LowPriorityTags)
	}
	if len(initial.DefaultLowPriorityTags) != 3 {
		t.Error("expected defaultLowPriorityTags hint to be populated")
	}

	// Updating only the low-priority list must leave preferences untouched
	// (pointer fields → independent updates) and dedupe case-insensitively.
	body, _ := json.Marshal(map[string]any{"lowPriorityTags": []string{" Beta ", "Sample", "sample", ""}})
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
		Preferences     []string `json:"preferences"`
		LowPriorityTags []string `json:"lowPriorityTags"`
	}
	json.NewDecoder(resp2.Body).Decode(&after)
	if len(after.LowPriorityTags) != 2 || after.LowPriorityTags[0] != "Beta" || after.LowPriorityTags[1] != "Sample" {
		t.Errorf("after PUT lowPriorityTags = %v, want [Beta Sample] (trimmed/deduped)", after.LowPriorityTags)
	}
	if len(after.Preferences) != 2 || after.Preferences[0] != "USA" || after.Preferences[1] != "World" {
		t.Errorf("preferences should be untouched by a low-priority-only PUT, got %v", after.Preferences)
	}
}

func TestMappingLowPriorityTags_OverrideAndInherit(t *testing.T) {
	ts, srcRoot, dstRoot, store := setupTestServer(t)

	created, err := store.Add(config.Mapping{
		Name:        "Test Mapping",
		SourcePaths: []string{filepath.Join(srcRoot, "console-a")},
		DestPath:    dstRoot,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Set a global low-priority list so inheritance is observable.
	body, _ := json.Marshal(map[string]any{"lowPriorityTags": []string{"Demo"}})
	r, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/settings", bytes.NewReader(body))
	if got, _ := http.DefaultClient.Do(r); got.StatusCode != http.StatusOK {
		t.Fatalf("seed global low-priority status=%d", got.StatusCode)
	}

	// No override → inherit the global list.
	resp, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer resp.Body.Close()
	var detail struct {
		Mapping                  config.Mapping `json:"mapping"`
		EffectiveLowPriorityTags []string       `json:"effectiveLowPriorityTags"`
	}
	json.NewDecoder(resp.Body).Decode(&detail)
	if detail.Mapping.LowPriorityTags != nil {
		t.Errorf("expected nil per-mapping override, got %v", detail.Mapping.LowPriorityTags)
	}
	if len(detail.EffectiveLowPriorityTags) != 1 || detail.EffectiveLowPriorityTags[0] != "Demo" {
		t.Errorf("effective low-priority = %v, want [Demo] inherited", detail.EffectiveLowPriorityTags)
	}

	// Per-mapping override wins over the global list.
	overrideBody, _ := json.Marshal(map[string]any{"lowPriorityTags": []string{"Beta"}})
	pReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID+"/low-priority-tags", bytes.NewReader(overrideBody))
	pReq.Header.Set("Content-Type", "application/json")
	pResp, _ := http.DefaultClient.Do(pReq)
	defer pResp.Body.Close()
	if pResp.StatusCode != http.StatusOK {
		t.Fatalf("PUT mapping low-priority status=%d", pResp.StatusCode)
	}

	resp2, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer resp2.Body.Close()
	json.NewDecoder(resp2.Body).Decode(&detail)
	if detail.Mapping.LowPriorityTags == nil || (*detail.Mapping.LowPriorityTags)[0] != "Beta" {
		t.Errorf("override not stored, got %+v", detail.Mapping.LowPriorityTags)
	}
	if len(detail.EffectiveLowPriorityTags) != 1 || detail.EffectiveLowPriorityTags[0] != "Beta" {
		t.Errorf("effective low-priority = %v, want [Beta] from override", detail.EffectiveLowPriorityTags)
	}

	// Clearing (null) reverts to inheriting the global list.
	clearReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID+"/low-priority-tags",
		bytes.NewReader([]byte(`{"lowPriorityTags":null}`)))
	clearReq.Header.Set("Content-Type", "application/json")
	cResp, _ := http.DefaultClient.Do(clearReq)
	defer cResp.Body.Close()
	if cResp.StatusCode != http.StatusOK {
		t.Fatalf("clear status=%d", cResp.StatusCode)
	}
	resp3, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer resp3.Body.Close()
	var afterClear struct {
		Mapping                  config.Mapping `json:"mapping"`
		EffectiveLowPriorityTags []string       `json:"effectiveLowPriorityTags"`
	}
	json.NewDecoder(resp3.Body).Decode(&afterClear)
	if afterClear.Mapping.LowPriorityTags != nil {
		t.Errorf("expected cleared override, got %+v", afterClear.Mapping.LowPriorityTags)
	}
	if len(afterClear.EffectiveLowPriorityTags) != 1 || afterClear.EffectiveLowPriorityTags[0] != "Demo" {
		t.Errorf("effective low-priority after clear = %v, want [Demo] (back to global)", afterClear.EffectiveLowPriorityTags)
	}
}

func TestMappingPreferences_OverrideAndInherit(t *testing.T) {
	ts, srcRoot, dstRoot, store := setupTestServer(t)

	created, err := store.Add(config.Mapping{
		Name:        "Test Mapping",
		SourcePaths: []string{filepath.Join(srcRoot, "console-a")},
		DestPath:    dstRoot,
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

func TestUpdateMapping_AllowedExtensionsRoundTrip(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	body, _ := json.Marshal(map[string]string{
		"name":       "Test Mapping",
		"sourcePath": filepath.Join(srcRoot, "console-a"),
		"destPath":   dstRoot,
	})
	resp, _ := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(body))
	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	// Mixed-case + leading-dot inconsistency + duplicates → all normalized
	// to canonical lowercase ".ext" entries with no duplicates.
	updateBody, _ := json.Marshal(map[string]any{
		"name":              "Test Mapping",
		"sourcePaths":       []string{filepath.Join(srcRoot, "console-a")},
		"destPath":          dstRoot,
		"allowedExtensions": []string{"RVZ", ".cso", "cso", " chd "},
	})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID,
		bytes.NewReader(updateBody))
	req.Header.Set("Content-Type", "application/json")
	put, _ := http.DefaultClient.Do(req)
	put.Body.Close()
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT status=%d", put.StatusCode)
	}

	getResp, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer getResp.Body.Close()
	var detail struct {
		Mapping config.Mapping `json:"mapping"`
	}
	json.NewDecoder(getResp.Body).Decode(&detail)
	got := detail.Mapping.AllowedExtensions
	want := []string{".rvz", ".cso", ".chd"}
	if len(got) != len(want) {
		t.Fatalf("AllowedExtensions=%v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("AllowedExtensions[%d]=%q, want %q", i, got[i], want[i])
		}
	}
}

func TestEndToEnd_AltExtSyncSkipsAndDeletes(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	// Pre-existing alt-ext file in dest (e.g. user converted it externally
	// and dropped it in). With ".rvz" allowed, sync must leave it alone.
	convertedPath := filepath.Join(dstRoot, "Example Game 1 (USA).rvz")
	if err := os.WriteFile(convertedPath, []byte("rvz"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{
		"name":       "Test Mapping",
		"sourcePath": filepath.Join(srcRoot, "console-a"),
		"destPath":   dstRoot,
	})
	resp, _ := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(body))
	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	// Configure allowed extensions on the mapping.
	updateBody, _ := json.Marshal(map[string]any{
		"name":              "Test Mapping",
		"sourcePaths":       []string{filepath.Join(srcRoot, "console-a")},
		"destPath":          dstRoot,
		"allowedExtensions": []string{".rvz"},
	})
	updReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID,
		bytes.NewReader(updateBody))
	updReq.Header.Set("Content-Type", "application/json")
	if r, _ := http.DefaultClient.Do(updReq); r.StatusCode != http.StatusOK {
		t.Fatalf("PUT mapping status=%d", r.StatusCode)
	}

	// Sync with intended including the .zip whose .rvz alt-ext already
	// exists. No copy, no delete.
	syncBody, _ := json.Marshal(map[string]any{
		"intended": intendedFiles(filepath.Join(srcRoot, "console-a"), "Example Game 1 (USA).zip"),
	})
	r, _ := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync",
		"application/json", bytes.NewReader(syncBody))
	defer r.Body.Close()
	if r.StatusCode != http.StatusOK {
		t.Fatalf("sync status=%d", r.StatusCode)
	}
	var result struct {
		Copied  []string `json:"copied"`
		Deleted []string `json:"deleted"`
	}
	json.NewDecoder(r.Body).Decode(&result)
	if len(result.Copied) != 0 {
		t.Errorf("Copied=%v, want empty (.rvz alt-ext satisfies)", result.Copied)
	}
	if len(result.Deleted) != 0 {
		t.Errorf("Deleted=%v, want empty (alt-ext file must be kept)", result.Deleted)
	}
	if _, err := os.Stat(convertedPath); err != nil {
		t.Errorf("converted alt-ext file removed: %v", err)
	}

	// Now deselect the game entirely. Sync should delete the alt-ext
	// file (it is "managed" via alt-ext to a known source file).
	emptySync, _ := json.Marshal(map[string]any{"intended": []map[string]string{}})
	r2, _ := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync",
		"application/json", bytes.NewReader(emptySync))
	defer r2.Body.Close()
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("second sync status=%d", r2.StatusCode)
	}
	if _, err := os.Stat(convertedPath); !os.IsNotExist(err) {
		t.Errorf("expected alt-ext file removed, got err=%v", err)
	}
}

func TestUpdateMapping_MultiSourceAndPrimary(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	// A second source directory under the same root.
	consoleB := filepath.Join(srcRoot, "console-b")
	if err := os.MkdirAll(consoleB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(consoleB, "Other Game (USA).zip"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{
		"name":       "Test Mapping",
		"sourcePath": filepath.Join(srcRoot, "console-a"),
		"destPath":   dstRoot,
	})
	resp, _ := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(body))
	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	consoleA := filepath.Join(srcRoot, "console-a")
	updateBody, _ := json.Marshal(map[string]any{
		"name":          "Test Mapping",
		"sourcePaths":   []string{consoleA, consoleB},
		"primarySource": consoleB,
		"destPath":      dstRoot,
	})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID, bytes.NewReader(updateBody))
	req.Header.Set("Content-Type", "application/json")
	put, _ := http.DefaultClient.Do(req)
	put.Body.Close()
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT status=%d", put.StatusCode)
	}

	getResp, _ := http.Get(ts.URL + "/api/mappings/" + created.ID)
	defer getResp.Body.Close()
	var detail struct {
		Mapping config.Mapping `json:"mapping"`
		Sources []struct {
			Path  string   `json:"path"`
			Files []string `json:"files"`
		} `json:"sources"`
	}
	json.NewDecoder(getResp.Body).Decode(&detail)
	if len(detail.Mapping.SourcePaths) != 2 {
		t.Fatalf("SourcePaths=%v, want 2 entries", detail.Mapping.SourcePaths)
	}
	if detail.Mapping.PrimarySource != consoleB {
		t.Errorf("PrimarySource=%q, want %q", detail.Mapping.PrimarySource, consoleB)
	}
	if len(detail.Sources) != 2 || detail.Sources[0].Path != consoleA || detail.Sources[1].Path != consoleB {
		t.Errorf("sources views=%+v, want [console-a, console-b] in order", detail.Sources)
	}

	// Primary that isn't one of the sources must be rejected.
	badBody, _ := json.Marshal(map[string]any{
		"name":          "Test Mapping",
		"sourcePaths":   []string{consoleA},
		"primarySource": consoleB,
		"destPath":      dstRoot,
	})
	badReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID, bytes.NewReader(badBody))
	badReq.Header.Set("Content-Type", "application/json")
	bad, _ := http.DefaultClient.Do(badReq)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 when primarySource is not a source folder, got %d", bad.StatusCode)
	}
}

func TestEndToEnd_SyncFromMultipleSources(t *testing.T) {
	ts, srcRoot, dstRoot, _ := setupTestServer(t)

	consoleA := filepath.Join(srcRoot, "console-a")
	consoleB := filepath.Join(srcRoot, "console-b")
	if err := os.MkdirAll(consoleB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(consoleB, "Other Game (USA).zip"), []byte("from-b"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{
		"name":       "Test Mapping",
		"sourcePath": consoleA,
		"destPath":   dstRoot,
	})
	resp, _ := http.Post(ts.URL+"/api/mappings", "application/json", bytes.NewReader(body))
	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	updateBody, _ := json.Marshal(map[string]any{
		"name":        "Test Mapping",
		"sourcePaths": []string{consoleA, consoleB},
		"destPath":    dstRoot,
	})
	uReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/mappings/"+created.ID, bytes.NewReader(updateBody))
	uReq.Header.Set("Content-Type", "application/json")
	if r, _ := http.DefaultClient.Do(uReq); r.StatusCode != http.StatusOK {
		t.Fatalf("PUT status=%d", r.StatusCode)
	}

	// Select one file from each source — both must be copied from their
	// respective directories.
	intended := append(
		intendedFiles(consoleA, "Example Game 1 (USA).zip"),
		intendedFiles(consoleB, "Other Game (USA).zip")...,
	)
	syncBody, _ := json.Marshal(map[string]any{"intended": intended})
	r, _ := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync", "application/json", bytes.NewReader(syncBody))
	defer r.Body.Close()
	if r.StatusCode != http.StatusOK {
		t.Fatalf("sync status=%d", r.StatusCode)
	}

	if got, _ := os.ReadFile(filepath.Join(dstRoot, "Other Game (USA).zip")); string(got) != "from-b" {
		t.Errorf("Other Game content=%q, want %q (copied from console-b)", got, "from-b")
	}
	if _, err := os.Stat(filepath.Join(dstRoot, "Example Game 1 (USA).zip")); err != nil {
		t.Errorf("file from console-a not copied: %v", err)
	}

	// A sync that names a source dir not on the mapping must be rejected.
	outside := t.TempDir() // not under the configured --source root either
	badSync, _ := json.Marshal(map[string]any{
		"intended": intendedFiles(outside, "Whatever.zip"),
	})
	bad, _ := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync", "application/json", bytes.NewReader(badSync))
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for intended file from an unconfigured source, got %d", bad.StatusCode)
	}
}

func TestSync_ToleratesNonCanonicalStoredSourcePath(t *testing.T) {
	// A mapping whose stored source path is non-canonical (trailing slash /
	// embedded "/./") — as could arise from a migrated legacy entry — must
	// still match the canonical dir the editor sends on sync.
	ts, srcRoot, dstRoot, store := setupTestServer(t)

	consoleA := filepath.Join(srcRoot, "console-a")
	noisy := consoleA + "/./" // same dir, non-canonical spelling
	created, err := store.Add(config.Mapping{
		Name:        "Test Mapping",
		SourcePaths: []string{noisy},
		DestPath:    dstRoot,
	})
	if err != nil {
		t.Fatal(err)
	}

	syncBody, _ := json.Marshal(map[string]any{
		"intended": intendedFiles(consoleA, "Example Game 1 (USA).zip"),
	})
	r, _ := http.Post(ts.URL+"/api/mappings/"+created.ID+"/sync", "application/json", bytes.NewReader(syncBody))
	defer r.Body.Close()
	if r.StatusCode != http.StatusOK {
		t.Fatalf("sync status=%d, want 200 (canonical dir should match non-canonical stored path)", r.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(dstRoot, "Example Game 1 (USA).zip")); err != nil {
		t.Errorf("file was not copied: %v", err)
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
