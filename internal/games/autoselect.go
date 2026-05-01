package games

import (
	"regexp"
	"strconv"
)

var revRegexp = regexp.MustCompile(`(?i)^Rev\s*(\d+)$`)

// AutoSelect picks the "best" file from a group of files that share a
// prefix, following the project's stated priority:
//
//  1. Drop files tagged Demo or Proto when at least one non-Demo/Proto exists.
//  2. Prefer USA, then World; fall back to whatever remains.
//  3. Among ties, pick the highest revision (Rev N).
//
// AutoSelect returns "" if files is empty.
func AutoSelect(files []string) string {
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

	if usa := withTag(candidates, "USA"); len(usa) > 0 {
		return pickHighestRev(usa)
	}
	if world := withTag(candidates, "World"); len(world) > 0 {
		return pickHighestRev(world)
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
