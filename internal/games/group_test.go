package games

import (
	"reflect"
	"testing"
)

func TestGroupFiles_ByPrefix(t *testing.T) {
	files := []string{
		"Example Game 1 (USA).zip",
		"Example Game 1 (Japan).zip",
		"Example Game 2 (World) (Rev 1).zip",
		"Example Game 2 (World) (Rev 2).zip",
	}
	got := GroupFiles(files, nil)
	want := []Group{
		{Prefix: "Example Game 1", Files: []string{
			"Example Game 1 (Japan).zip",
			"Example Game 1 (USA).zip",
		}},
		{Prefix: "Example Game 2", Files: []string{
			"Example Game 2 (World) (Rev 1).zip",
			"Example Game 2 (World) (Rev 2).zip",
		}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("GroupFiles by prefix mismatch.\n got=%v\nwant=%v", got, want)
	}
}

func TestGroupFiles_ManualOverride(t *testing.T) {
	files := []string{
		"Example Game 1 (USA).zip",
		"Some Different Title (Japan).zip",
	}
	manual := map[string]string{
		"Some Different Title (Japan).zip": "Example Game 1",
	}
	got := GroupFiles(files, manual)
	want := []Group{
		{Prefix: "Example Game 1", Files: []string{
			"Example Game 1 (USA).zip",
			"Some Different Title (Japan).zip",
		}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("GroupFiles manual override mismatch.\n got=%v\nwant=%v", got, want)
	}
}

func TestGroupFiles_SortedCaseInsensitive(t *testing.T) {
	files := []string{
		"banana title.zip",
		"Apple Title.zip",
		"cherry title.zip",
	}
	got := GroupFiles(files, nil)
	if len(got) != 3 {
		t.Fatalf("expected 3 groups, got %d", len(got))
	}
	if got[0].Prefix != "Apple Title" || got[1].Prefix != "banana title" || got[2].Prefix != "cherry title" {
		t.Errorf("expected case-insensitive sort, got %v", []string{got[0].Prefix, got[1].Prefix, got[2].Prefix})
	}
}
