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

// DefaultLowPriorityTags lists the tags that mark a variant as a last
// resort: a file carrying any of them is only selected when its game has
// no other variant. Demo and Proto were the original hardcoded exclusions;
// Sample is included by default for the same reason. Tags are matched
// case-insensitively (see Parsed.HasTag) and the list is overridable both
// globally and per-mapping.
var DefaultLowPriorityTags = []string{"Demo", "Proto", "Sample"}

// AutoSelect picks the "best" file from a group of files that share a
// prefix using DefaultPreferences and DefaultLowPriorityTags. See
// AutoSelectWith for the configurable variant.
func AutoSelect(files []string) string {
	return AutoSelectWith(files, DefaultPreferences, DefaultLowPriorityTags)
}

// AutoSelectWith picks the "best" file from a group of files that share
// a prefix, following the project's selection priority:
//
//  1. Drop files carrying any low-priority tag when at least one file with
//     no low-priority tag exists.
//  2. Walk preferences in order; the first tag that matches at least one
//     candidate wins. Empty preference strings are skipped.
//  3. Among ties (or when no preference matches), pick the highest revision
//     (Rev N).
//
// AutoSelectWith returns "" if files is empty.
func AutoSelectWith(files []string, preferences, lowPriorityTags []string) string {
	if len(files) == 0 {
		return ""
	}

	parsed := make([]Parsed, len(files))
	for i, f := range files {
		parsed[i] = ParseName(f)
	}

	candidates := dropLowPriority(parsed, lowPriorityTags)
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

// dropLowPriority returns the parsed files that carry none of the
// low-priority tags. When every file is low-priority this returns an empty
// slice and AutoSelectWith falls back to the full set, so a game whose only
// variants are Demo/Sample still resolves to one of them.
func dropLowPriority(in []Parsed, lowPriorityTags []string) []Parsed {
	out := make([]Parsed, 0, len(in))
	for _, p := range in {
		if hasAnyTag(p, lowPriorityTags) {
			continue
		}
		out = append(out, p)
	}
	return out
}

func hasAnyTag(p Parsed, tags []string) bool {
	for _, t := range tags {
		if t == "" {
			continue
		}
		if p.HasTag(t) {
			return true
		}
	}
	return false
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
