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
