// Package games contains pure functions for parsing ROM filenames,
// grouping files into "games" by common prefix, and picking the best
// variant of a game when multiple files share a prefix.
package games

import (
	"path/filepath"
	"regexp"
	"strings"
)

var tagRegexp = regexp.MustCompile(`\(([^)]*)\)`)

// variantPartTag matches tags that mark a file as one piece of a
// multi-file game variant rather than a distinct selectable variant —
// `Track N` (numeric, No-Intro/Redump convention) and `Side X` (single
// letter). Conservative on purpose: real title fragments like "Side
// Quest" or "Track Star Edition" must survive variant-key collapse.
// `Disc N` is intentionally NOT here — different discs are distinct
// variants. Mirror of `VARIANT_PART_TAG` in `web/src/lib/games.ts`.
var variantPartTag = regexp.MustCompile(`(?i)^(?:Track\s+\d+|Side\s+[A-Z])$`)

// Parsed describes a filename split into its game prefix and the list of
// tags found in parentheses, in order of appearance.
type Parsed struct {
	Filename string
	Prefix   string
	Tags     []string
}

// ParseName splits a ROM filename into its prefix (everything before the
// first parenthesis, with the extension trimmed) and the ordered list of
// parenthesised tag groups. Files with no parentheses parse to a prefix
// equal to the bare basename and an empty tag slice.
func ParseName(filename string) Parsed {
	base := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))

	cut := strings.Index(base, "(")
	prefix := base
	if cut >= 0 {
		prefix = base[:cut]
	}
	prefix = strings.TrimSpace(prefix)

	matches := tagRegexp.FindAllStringSubmatch(base, -1)
	tags := make([]string, 0, len(matches))
	for _, m := range matches {
		tags = append(tags, strings.TrimSpace(m[1]))
	}

	return Parsed{Filename: filename, Prefix: prefix, Tags: tags}
}

// VariantKey returns the parsed prefix joined with each tag that is
// not a multi-file part marker (Track N, Side X). Files that share a
// VariantKey belong to the same logical "game variant": e.g. a cue
// and its multiple bin tracks all collapse to one key, while different
// regions or different discs remain distinct. Files with no surviving
// tags collapse to the bare prefix.
//
// Mirror of `variantKey` in `web/src/lib/games.ts` — keep in sync when
// changing what counts as a variant-part tag.
func VariantKey(filename string) string {
	p := ParseName(filename)
	keep := make([]string, 0, len(p.Tags))
	for _, t := range p.Tags {
		if variantPartTag.MatchString(t) {
			continue
		}
		keep = append(keep, t)
	}
	if len(keep) == 0 {
		return p.Prefix
	}
	return p.Prefix + " (" + strings.Join(keep, ") (") + ")"
}

// HasTag reports whether the parsed name carries the given tag
// (case-insensitive). A parenthesised group like "(USA, Europe)" matches
// both "USA" and "Europe" — comma-separated parts are each checked.
func (p Parsed) HasTag(tag string) bool {
	for _, t := range p.Tags {
		for _, part := range strings.Split(t, ",") {
			if strings.EqualFold(strings.TrimSpace(part), tag) {
				return true
			}
		}
	}
	return false
}
