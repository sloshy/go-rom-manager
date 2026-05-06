package games

import "testing"

func TestAutoSelect_PrefersUSA(t *testing.T) {
	files := []string{
		"Example Game 1 (Japan).zip",
		"Example Game 1 (USA).zip",
		"Example Game 1 (Europe).zip",
	}
	if got := AutoSelect(files); got != "Example Game 1 (USA).zip" {
		t.Errorf("AutoSelect = %q, want USA pick", got)
	}
}

func TestAutoSelect_FallsBackToWorld(t *testing.T) {
	files := []string{
		"Example Game 2 (Japan).zip",
		"Example Game 2 (World).zip",
		"Example Game 2 (Europe).zip",
	}
	if got := AutoSelect(files); got != "Example Game 2 (World).zip" {
		t.Errorf("AutoSelect = %q, want World pick", got)
	}
}

func TestAutoSelect_HighestRevWithinPriority(t *testing.T) {
	files := []string{
		"Example Game 3 (USA) (Rev 1).zip",
		"Example Game 3 (USA) (Rev 2).zip",
		"Example Game 3 (USA).zip",
	}
	if got := AutoSelect(files); got != "Example Game 3 (USA) (Rev 2).zip" {
		t.Errorf("AutoSelect = %q, want highest Rev USA", got)
	}
}

func TestAutoSelect_ExcludesDemoAndProtoWhenAlternativesExist(t *testing.T) {
	files := []string{
		"Example Game 4 (USA) (Demo).zip",
		"Example Game 4 (USA) (Proto).zip",
		"Example Game 4 (USA).zip",
	}
	if got := AutoSelect(files); got != "Example Game 4 (USA).zip" {
		t.Errorf("AutoSelect = %q, want non-Demo non-Proto", got)
	}
}

func TestAutoSelect_AllDemoFallsBack(t *testing.T) {
	files := []string{
		"Example Game 5 (USA) (Demo).zip",
		"Example Game 5 (Japan) (Demo).zip",
	}
	got := AutoSelect(files)
	if got != "Example Game 5 (USA) (Demo).zip" {
		t.Errorf("AutoSelect = %q, want USA demo when only demos available", got)
	}
}

func TestAutoSelect_FullPriorityCombo(t *testing.T) {
	files := []string{
		"Example Game 2 (World) (Rev 1).zip",
		"Example Game 2 (World) (Rev 2).zip",
		"Example Game 2 (USA).zip",
		"Example Game 2 (USA) (Demo).zip",
	}
	if got := AutoSelect(files); got != "Example Game 2 (USA).zip" {
		t.Errorf("AutoSelect = %q, want USA non-demo over World/Rev/Demo", got)
	}
}

func TestAutoSelect_EmptyReturnsEmpty(t *testing.T) {
	if got := AutoSelect(nil); got != "" {
		t.Errorf("AutoSelect(nil) = %q, want empty", got)
	}
}

func TestAutoSelect_SingleFile(t *testing.T) {
	files := []string{"Example Game 7 (Japan).zip"}
	if got := AutoSelect(files); got != "Example Game 7 (Japan).zip" {
		t.Errorf("AutoSelect single file = %q, want pass-through", got)
	}
}

func TestAutoSelectWith_CustomPriority(t *testing.T) {
	files := []string{
		"Example Game 1 (USA).zip",
		"Example Game 1 (Japan).zip",
		"Example Game 1 (Europe).zip",
	}
	if got := AutoSelectWith(files, []string{"Japan", "USA"}); got != "Example Game 1 (Japan).zip" {
		t.Errorf("AutoSelectWith Japan-first = %q, want Japan pick", got)
	}
	if got := AutoSelectWith(files, []string{"Europe"}); got != "Example Game 1 (Europe).zip" {
		t.Errorf("AutoSelectWith Europe-only = %q, want Europe pick", got)
	}
}

func TestAutoSelectWith_EmptyPreferencesFallsBackToRev(t *testing.T) {
	files := []string{
		"Example Game 1 (USA).zip",
		"Example Game 1 (USA) (Rev 2).zip",
		"Example Game 1 (Japan).zip",
	}
	if got := AutoSelectWith(files, nil); got != "Example Game 1 (USA) (Rev 2).zip" {
		t.Errorf("AutoSelectWith nil prefs = %q, want highest Rev candidate", got)
	}
}

func TestAutoSelectWith_SkipsUnmatchedTagsInOrder(t *testing.T) {
	files := []string{
		"Example Game 1 (Japan).zip",
		"Example Game 1 (Europe).zip",
	}
	got := AutoSelectWith(files, []string{"USA", "Japan", "Europe"})
	if got != "Example Game 1 (Japan).zip" {
		t.Errorf("AutoSelectWith = %q, want Japan (first matching pref)", got)
	}
}

func TestAutoSelect_CompoundRegionTag(t *testing.T) {
	files := []string{
		"Example (Europe) (Rev 2).zip",
		"Example (Japan).zip",
		"Example (Japan) (Rev 1).zip",
		"Example (USA, Europe) (Rev 1).zip",
		"Example (USA, Europe).zip",
	}
	if got := AutoSelect(files); got != "Example (USA, Europe) (Rev 1).zip" {
		t.Errorf("AutoSelect = %q, want USA,Europe Rev 1 (not Europe Rev 2)", got)
	}
}

func TestAutoSelectWith_StillExcludesDemoAndProto(t *testing.T) {
	files := []string{
		"Example Game 1 (Japan) (Demo).zip",
		"Example Game 1 (Japan).zip",
	}
	if got := AutoSelectWith(files, []string{"Japan"}); got != "Example Game 1 (Japan).zip" {
		t.Errorf("AutoSelectWith demo filter = %q, want non-demo Japan", got)
	}
}
