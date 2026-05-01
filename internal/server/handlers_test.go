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
