package licenses

import (
	"strings"
	"testing"
)

func TestLoadProducesEntries(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(m.Go) == 0 {
		t.Fatalf("Go entries are empty — has scripts/bundle.sh run gen-licenses?")
	}
	// First Go entry is always the project itself.
	if m.Go[0].Name != "github.com/slosh/go-rom-manager" {
		t.Fatalf("Go[0].Name = %q, want the project module", m.Go[0].Name)
	}
	if !strings.Contains(strings.ToLower(m.Go[0].Text), "affero") {
		t.Fatalf("project license text should mention Affero (AGPL); got first 80 chars: %q", head(m.Go[0].Text, 80))
	}
}

func TestFindCaseInsensitiveExact(t *testing.T) {
	hits, err := Find("github.com/slosh/go-rom-manager")
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	if len(hits) != 1 || hits[0].Bucket != "go" {
		t.Fatalf("Find hits = %+v", hits)
	}

	upper, err := Find("GITHUB.COM/SLOSH/GO-ROM-MANAGER")
	if err != nil {
		t.Fatalf("Find upper: %v", err)
	}
	if len(upper) != 1 {
		t.Fatalf("case-insensitive match expected exactly one hit, got %d", len(upper))
	}

	if _, err := Find(""); err == nil {
		t.Fatalf("Find(\"\") should error")
	}
}

func TestFindMissing(t *testing.T) {
	hits, err := Find("does-not-exist-pkg")
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("expected no hits, got %+v", hits)
	}
}

func head(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}
