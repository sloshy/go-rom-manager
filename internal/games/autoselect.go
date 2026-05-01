package games

import (
	"regexp"
	"strconv"
)

var revRegexp = regexp.MustCompile(`(?i)^Rev\s*(\d+)$`)

// DefaultPreferences is the priority order used when no per-mapping or
// global override is configured: prefer USA, then World, then fall back
// to whatever remains.
var DefaultPreferences = []string{"USA", "World"}

// AutoSelect picks the "best" file from a group of files that share a
// prefix using DefaultPreferences. See AutoSelectWith for the
// preference-aware variant.
func AutoSelect(files []string) string {
	return AutoSelectWith(files, DefaultPreferences)
}

// AutoSelectWith picks the "best" file from a group of files that share
// a prefix, following the project's selection priority:
//
//  1. Drop files tagged Demo or Proto when at least one non-Demo/Proto exists.
//  2. Walk preferences in order; the first tag that matches at least one
//     candidate wins. Empty preference strings are skipped.
//  3. Among ties (or when no preference matches), pick the highest revision
//     (Rev N).
//
// AutoSelectWith returns "" if files is empty.
func AutoSelectWith(files []string, preferences []string) string {
	if len(files) == 0 {
		return ""
	}

	parsed := make([]Parsed, len(files))
	for i, f := range files {
		parsed[i] = ParseName(f)
	}

	candidates := filterPlayable(parsed)
	if len(candidates) == 0 {
		candidates = parsed
	}

	for _, tag := range preferences {
		if tag == "" {
			continue
		}
		if matched := withTag(candidates, tag); len(matched) > 0 {
			return pickHighestRev(matched)
		}
	}
	return pickHighestRev(candidates)
}

func filterPlayable(in []Parsed) []Parsed {
	out := make([]Parsed, 0, len(in))
	for _, p := range in {
		if p.HasTag("Demo") || p.HasTag("Proto") {
			continue
		}
		out = append(out, p)
	}
	return out
}

func withTag(in []Parsed, tag string) []Parsed {
	out := make([]Parsed, 0, len(in))
	for _, p := range in {
		if p.HasTag(tag) {
			out = append(out, p)
		}
	}
	return out
}

func pickHighestRev(in []Parsed) string {
	best := in[0]
	bestRev := revOf(best)
	for _, p := range in[1:] {
		r := revOf(p)
		if r > bestRev {
			best = p
			bestRev = r
		}
	}
	return best.Filename
}

// revOf returns the highest "Rev N" number found in the parsed tags, or
// 0 if none is present (treating the absence of a Rev tag as Rev 0).
func revOf(p Parsed) int {
	highest := 0
	for _, t := range p.Tags {
		m := revRegexp.FindStringSubmatch(t)
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err == nil && n > highest {
			highest = n
		}
	}
	return highest
}
