/**
 * Filter expressions and tag-token extraction for the editor's filter
 * bar and tag-filter dropdown. Pure helpers, no I/O. Mirror nothing on
 * the backend — these are UI-only concerns.
 *
 * Filter input is chip-style: space-separated tokens become individual
 * substring filters. A `-` prefix marks a chip as a negative (exclude).
 * Wrap a token in `"..."` to keep internal whitespace as one chip. See
 * `tokenizeFilterInput` (incremental, used while typing) and
 * `parseFilterChips` (one-shot, force-closes any trailing draft).
 *
 * `extractTagTokens` / `collectTagTokens` pull tag tokens from filename
 * (...) and [...] groups for the tag-filter dropdown. `fileMatchesTags`
 * / `groupMatchesTags` apply a 3-state filter map (off/positive/negative)
 * at file or group granularity.
 */

export interface FilterChip {
  /** Substring to match (display case preserved; matching lowercases). */
  text: string
  /** When true, the chip excludes anything containing `text`. */
  negative: boolean
}

/**
 * `-` is a negative-prefix marker only when followed by a non-whitespace
 * character that isn't itself a `-`. So `-foo` and `-"foo"` negate, but
 * `--foo` is a literal positive token (avoids ambiguity around how many
 * dashes to consume) and `- foo` / lone `-` are treated as plain text
 * which subsequent rules drop as garbage.
 */
function startsWithNegativeMarker(s: string): boolean {
  return s.length > 1 && s[0] === '-' && !/\s/.test(s[1]) && s[1] !== '-'
}

/** All-dash literals (`-`, `--`, `---`, ...) — never useful as a chip. */
const ALL_DASHES = /^-+$/

/**
 * Tokenize raw filter-input text into committed chips and any unfinished
 * suffix. Used while the user is typing: tokens separated by whitespace
 * are committed as chips; the trailing partial token (if any) stays in
 * the draft so the user can keep editing it.
 *
 * Syntax:
 *   - whitespace separates tokens
 *   - `"..."` wraps a token whose body may contain whitespace
 *   - a leading `-` (immediately before a non-whitespace, non-`-` char)
 *     marks the chip negative
 *
 * A bare token is "complete" only when followed by whitespace; a quoted
 * token is complete as soon as its closing `"` is seen. Anything still
 * unfinished — an open quote or a trailing bare word — is returned as
 * `remainder` verbatim.
 */
export function tokenizeFilterInput(input: string): {
  chips: FilterChip[]
  remainder: string
} {
  const chips: FilterChip[] = []
  let i = 0
  let boundary = 0

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++
    boundary = i
    if (i >= input.length) break

    const tokenStart = i
    const negative = startsWithNegativeMarker(input.slice(i))
    if (negative) i++

    let text: string
    if (input[i] === '"') {
      i++
      const start = i
      while (i < input.length && input[i] !== '"') i++
      if (i >= input.length) {
        return { chips, remainder: input.slice(tokenStart) }
      }
      text = input.slice(start, i)
      i++
    } else {
      const start = i
      while (i < input.length && !/\s/.test(input[i])) i++
      if (i >= input.length) {
        return { chips, remainder: input.slice(tokenStart) }
      }
      text = input.slice(start, i)
    }

    const t = text.trim()
    if (t && !ALL_DASHES.test(t)) chips.push({ text: t, negative })
    boundary = i
  }

  return { chips, remainder: input.slice(boundary) }
}

/**
 * Force-commit a draft into a single chip (Enter / blur). Applies the
 * same `-`-as-negative rule as the tokenizer and silently drops drafts
 * that boil down to nothing useful (empty body, all-dash literals,
 * empty quoted spans).
 */
export function commitFilterDraft(draft: string): FilterChip | null {
  let s = draft.trim()
  if (!s) return null
  let negative = false
  if (startsWithNegativeMarker(s)) {
    negative = true
    s = s.slice(1).trim()
  }
  if (s.startsWith('"')) s = s.slice(1)
  if (s.endsWith('"')) s = s.slice(0, -1)
  s = s.trim()
  if (!s || ALL_DASHES.test(s)) return null
  return { text: s, negative }
}

/**
 * One-shot: parse the entire input into chips, treating any unfinished
 * trailing draft as a final chip. Used by tests and any caller that
 * doesn't need incremental tokenization.
 */
export function parseFilterChips(input: string): FilterChip[] {
  const { chips, remainder } = tokenizeFilterInput(input)
  const last = commitFilterDraft(remainder)
  return last ? [...chips, last] : chips
}

/** True iff `text` satisfies every chip (positive substring + negative exclusions). */
export function matchesChips(text: string, chips: readonly FilterChip[]): boolean {
  if (chips.length === 0) return true
  const t = text.toLowerCase()
  for (const chip of chips) {
    const has = t.includes(chip.text.toLowerCase())
    if (chip.negative && has) return false
    if (!chip.negative && !has) return false
  }
  return true
}

/**
 * Extract every (...) / [...] body from a filename and split each on
 * commas, returning the deduped (case-insensitive) tokens in source order.
 * `(USA, Europe)` → ["USA", "Europe"]. `(Rev 2)` → ["Rev 2"] — spaces
 * within a comma-separated part are kept together so "Rev 1" is one token,
 * not two. A bare number like `(1)` is still a token when alone.
 */
export function extractTagTokens(filename: string): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  const add = (body: string) => {
    for (const p of body.split(/,/)) {
      const v = p.trim()
      if (!v) continue
      const lower = v.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      tokens.push(v)
    }
  }
  let m: RegExpExecArray | null
  const paren = /\(([^()]*)\)/g
  while ((m = paren.exec(filename)) !== null) add(m[1])
  const bracket = /\[([^\[\]]*)\]/g
  while ((m = bracket.exec(filename)) !== null) add(m[1])
  return tokens
}

/**
 * Union of tag tokens across all `filenames`, sorted case-insensitively.
 * Display form is taken from the first occurrence of each lowercased
 * token.
 */
export function collectTagTokens(filenames: readonly string[]): string[] {
  const seen = new Map<string, string>()
  for (const f of filenames) {
    for (const t of extractTagTokens(f)) {
      const k = t.toLowerCase()
      if (!seen.has(k)) seen.set(k, t)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export type TagFilterState = 'off' | 'positive' | 'negative'
export type TagFilters = Record<string, TagFilterState>

/** Click cycle order: off → positive → negative → off. */
export function nextTagFilterState(s: TagFilterState): TagFilterState {
  if (s === 'off') return 'positive'
  if (s === 'positive') return 'negative'
  return 'off'
}

/**
 * Filename → set of its tag tokens, lowercased. Lookup callers MUST
 * lowercase the query before `has(...)` — the case-folding invariant is
 * what makes the membership check correct against display-cased filter
 * keys like `"USA"`.
 */
function lowerCasedTokenSet(filename: string): Set<string> {
  return new Set(extractTagTokens(filename).map((t) => t.toLowerCase()))
}

/** True iff the filename's tag tokens satisfy every active filter. */
export function fileMatchesTags(filename: string, filters: TagFilters): boolean {
  let toks: Set<string> | null = null
  for (const [tag, state] of Object.entries(filters)) {
    if (state === 'off') continue
    if (toks === null) toks = lowerCasedTokenSet(filename)
    const has = toks.has(tag.toLowerCase())
    if (state === 'positive' && !has) return false
    if (state === 'negative' && has) return false
  }
  return true
}

/**
 * Group-level satisfaction: positive passes when at least one file in
 * the group has the tag; negative passes when no file in the group has
 * it.
 */
export function groupMatchesTags(files: readonly string[], filters: TagFilters): boolean {
  for (const [tag, state] of Object.entries(filters)) {
    if (state === 'off') continue
    const lower = tag.toLowerCase()
    const anyHas = files.some((f) => lowerCasedTokenSet(f).has(lower))
    if (state === 'positive' && !anyHas) return false
    if (state === 'negative' && anyHas) return false
  }
  return true
}

/** Number of filters currently positive or negative (i.e. not off). */
export function activeTagFilterCount(filters: TagFilters): number {
  let n = 0
  for (const state of Object.values(filters)) if (state !== 'off') n++
  return n
}

/** True iff at least one filter is active (positive or negative). */
export function hasActiveTagFilters(filters: TagFilters): boolean {
  return activeTagFilterCount(filters) > 0
}
