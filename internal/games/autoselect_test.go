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
