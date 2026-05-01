package games

import (
	"reflect"
	"testing"
)

func TestParseName(t *testing.T) {
	cases := []struct {
		in     string
		prefix string
		tags   []string
	}{
		{"Example Game 1 (USA).zip", "Example Game 1", []string{"USA"}},
		{"Example Game 2 (World) (Rev 2).zip", "Example Game 2", []string{"World", "Rev 2"}},
		{"Example Game 3 (Japan) (Demo).7z", "Example Game 3", []string{"Japan", "Demo"}},
		{"Plain Title.zip", "Plain Title", []string{}},
		{"   Spaced  Title  (USA).zip", "Spaced  Title", []string{"USA"}},
		{"/abs/path/Example Game 4 (USA) (Proto).zip", "Example Game 4", []string{"USA", "Proto"}},
	}
	for _, c := range cases {
		got := ParseName(c.in)
		if got.Prefix != c.prefix {
			t.Errorf("ParseName(%q).Prefix = %q, want %q", c.in, got.Prefix, c.prefix)
		}
		if !reflect.DeepEqual(got.Tags, c.tags) {
			t.Errorf("ParseName(%q).Tags = %v, want %v", c.in, got.Tags, c.tags)
		}
	}
}

func TestHasTag(t *testing.T) {
	p := ParseName("Example Game 1 (USA) (Rev 1).zip")
	if !p.HasTag("USA") {
		t.Errorf("expected USA tag")
	}
	if !p.HasTag("usa") {
		t.Errorf("expected case-insensitive tag match")
	}
	if p.HasTag("Japan") {
		t.Errorf("did not expect Japan tag")
	}
}
