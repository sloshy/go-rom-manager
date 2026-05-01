package games

import "sort"

// Group is a collection of files that share a common prefix (either parsed
// from the filename or assigned via a manual override).
type Group struct {
	Prefix string   `json:"prefix"`
	Files  []string `json:"files"`
}

// GroupFiles partitions the given filenames into groups keyed by prefix.
// manualGroups maps a filename to a prefix that overrides the one parsed
// from its name; this is the mechanism for merging things like a Japanese
// release into the same group as its Western counterpart.
//
// Returned groups are sorted by prefix (case-insensitive); files within a
// group are sorted alphabetically.
func GroupFiles(files []string, manualGroups map[string]string) []Group {
	byPrefix := make(map[string][]string)
	for _, f := range files {
		var prefix string
		if override, ok := manualGroups[f]; ok && override != "" {
			prefix = override
		} else {
			prefix = ParseName(f).Prefix
		}
		byPrefix[prefix] = append(byPrefix[prefix], f)
	}

	out := make([]Group, 0, len(byPrefix))
	for prefix, fs := range byPrefix {
		sort.Strings(fs)
		out = append(out, Group{Prefix: prefix, Files: fs})
	}
	sort.Slice(out, func(i, j int) bool {
		return foldLess(out[i].Prefix, out[j].Prefix)
	})
	return out
}

func foldLess(a, b string) bool {
	la, lb := len(a), len(b)
	n := la
	if lb < n {
		n = lb
	}
	for i := 0; i < n; i++ {
		ca, cb := lower(a[i]), lower(b[i])
		if ca != cb {
			return ca < cb
		}
	}
	return la < lb
}

func lower(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 32
	}
	return c
}
