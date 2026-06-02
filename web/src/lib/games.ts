/**
 * Pure helpers that mirror the Go `internal/games` package: parse a ROM
 * filename into prefix + tags, group files by prefix (honouring manual
 * overrides), and pick the best variant of a multi-file game group.
 */

export interface Parsed {
  filename: string
  prefix: string
  tags: string[]
}

export interface GameGroup {
  prefix: string
  files: string[]
}

/**
 * A set of files that belong to the same logical "game variant" — used
 * to render multi-file games (cue + multiple bins, or any group sharing
 * a prefix and non-track tags) as a single toggleable row. The set's
 * key is the variant key (see `variantKey`), not just the stem.
 */
export interface FileBundle {
  /**
   * The variant key shared by every file in the bundle. Used as the
   * row label. e.g. "Sample Title (USA)" for a cue+multi-bin set whose
   * tracks differ only by `(Track N)` tags.
   */
  label: string
  /** All files in this variant, alphabetically sorted. */
  files: string[]
  /** Lowercase extensions in `files`, in `files` order, for badge display. */
  extensions: string[]
}

const KNOWN_EXTS = [
  '.zip',
  '.7z',
  '.rar',
  '.bin',
  '.smc',
  '.sfc',
  '.gen',
  '.md',
  '.n64',
  '.z64',
  '.nes',
]

const COMPOUND_EXTS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst'] as const

/**
 * Strip the trailing ROM extension from a filename so the tag-parsing
 * regex doesn't mistake it for a parenthesised group. Used ONLY by
 * `parseName` (prefix + tags). Do not use this for alt-extension
 * matching — it whitelists known ROM formats and conservatively trims
 * unknown 1–5 character suffixes, which is the wrong rule for a
 * user-configured allowed-extension list. Use `fileStem` / `fileExt`
 * (last-dot semantics, mirrors Go's `filepath.Ext`) for that.
 */
function trimExt(name: string): string {
  const lower = name.toLowerCase()
  for (const ext of KNOWN_EXTS) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length)
  }
  const dot = name.lastIndexOf('.')
  if (dot > 0 && name.length - dot <= 5) return name.slice(0, dot)
  return name
}

/**
 * Returns the filename with its trailing extension removed. Recognises
 * compound extensions (e.g. `.tar.gz`) as a single unit so that
 * `fileStem(f) + fileExt(f) === f` holds for all inputs.
 */
export function fileStem(filename: string): string {
  const lower = filename.toLowerCase()
  for (const ext of COMPOUND_EXTS) {
    if (lower.endsWith(ext)) return filename.slice(0, filename.length - ext.length)
  }
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return filename
  return filename.slice(0, dot)
}

/**
 * Returns the lowercase extension (including the leading dot) or the
 * empty string for files with no dotted suffix. Compound extensions such
 * as `.tar.gz` are returned as a single token rather than just the last
 * segment.
 */
export function fileExt(filename: string): string {
  const lower = filename.toLowerCase()
  for (const ext of COMPOUND_EXTS) {
    if (lower.endsWith(ext)) return ext
  }
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return ''
  return filename.slice(dot).toLowerCase()
}

/**
 * Reports whether `filename` carries an extension in `allowed`. The
 * `allowed` list is expected to be normalized to lowercase ".ext" form;
 * this function lowercases the file's extension before comparison.
 */
export function isAllowedExt(filename: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return false
  const ext = fileExt(filename)
  if (!ext) return false
  return allowed.includes(ext)
}

export function parseName(filename: string): Parsed {
  const base = trimExt(filename)
  const cut = base.indexOf('(')
  const prefix = (cut >= 0 ? base.slice(0, cut) : base).trim()
  const tags: string[] = []
  const re = /\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(base)) !== null) tags.push(m[1].trim())
  return { filename, prefix, tags }
}

export function hasTag(p: Parsed, tag: string): boolean {
  return p.tags.some((t) =>
    t.split(',').some((part) => part.trim().toLowerCase() === tag.toLowerCase()),
  )
}

/** Reports whether the parsed name carries any of the given tags. */
export function hasAnyTag(p: Parsed, tags: readonly string[]): boolean {
  return tags.some((t) => t !== '' && hasTag(p, t))
}

export function groupFiles(
  files: string[],
  manualGroups: Record<string, string> = {},
): GameGroup[] {
  const buckets = new Map<string, string[]>()
  for (const f of files) {
    const override = manualGroups[f]
    const prefix = override && override.length > 0 ? override : parseName(f).prefix
    const arr = buckets.get(prefix) ?? []
    arr.push(f)
    buckets.set(prefix, arr)
  }
  const out: GameGroup[] = []
  for (const [prefix, fs] of buckets) {
    out.push({ prefix, files: fs.slice().sort((a, b) => a.localeCompare(b)) })
  }
  out.sort((a, b) => a.prefix.localeCompare(b.prefix, undefined, { sensitivity: 'base' }))
  return out
}

const REV_RE = /^Rev\s*(\d+)$/i

function revOf(p: Parsed): number {
  let highest = 0
  for (const t of p.tags) {
    const m = REV_RE.exec(t)
    if (m) {
      const n = Number(m[1])
      if (n > highest) highest = n
    }
  }
  return highest
}

export const DEFAULT_PREFERENCES: readonly string[] = ['USA', 'World']

/**
 * Tags that demote a variant to "last resort": a file carrying any of
 * them is only selected when its game has no cleaner variant. Demo and
 * Proto were the original hardcoded exclusions; Sample is included by
 * default for the same reason. Mirror of `DefaultLowPriorityTags` in the
 * Go `internal/games` package — keep the two in sync.
 */
export const DEFAULT_LOW_PRIORITY_TAGS: readonly string[] = ['Demo', 'Proto', 'Sample']

export function autoSelect(
  files: string[],
  preferences: readonly string[] = DEFAULT_PREFERENCES,
  lowPriorityTags: readonly string[] = DEFAULT_LOW_PRIORITY_TAGS,
): string {
  if (files.length === 0) return ''
  const parsed = files.map(parseName)
  const playable = parsed.filter((p) => !hasAnyTag(p, lowPriorityTags))
  const candidates = playable.length > 0 ? playable : parsed

  for (const tag of preferences) {
    if (!tag) continue
    const matched = candidates.filter((p) => hasTag(p, tag))
    if (matched.length > 0) return pickHighestRev(matched)
  }
  return pickHighestRev(candidates)
}

/**
 * Tags that mark a file as one piece of a multi-file game variant
 * rather than a distinct selectable variant of its own. Stripped from
 * the variant key so e.g. `Game (USA).cue`, `Game (USA) (Track 1).bin`,
 * and `Game (USA) (Track 2).bin` all collapse to one variant.
 *
 * Conservative on purpose: `(Track N)` requires a number (No-Intro /
 * redump conventions are always numeric), `(Side X)` requires a single
 * letter. This keeps real game-title fragments like `(Side Quest)` or
 * `(Track Star Edition)` from being mistaken for multi-track markers.
 *
 * `(Disc N)` is intentionally NOT here — different discs are usually
 * separately-selectable units, so they remain distinct variants.
 */
const VARIANT_PART_TAG = /^(?:Track\s+\d+|Side\s+[A-Z])$/i

/**
 * The key shared by every file belonging to the same logical "game
 * variant": the parsed prefix plus the parsed tags with multi-track
 * markers stripped. For files with no tags this equals the stem.
 */
export function variantKey(filename: string): string {
  const p = parseName(filename)
  const keep = p.tags.filter((t) => !VARIANT_PART_TAG.test(t))
  return keep.length === 0 ? p.prefix : `${p.prefix} (${keep.join(') (')})`
}

/**
 * Bucket a flat list of filenames into variant bundles. Files sharing
 * a `variantKey` end up in one bundle — multi-track sets (cue + N
 * .bin files differing only by `(Track N)`) collapse, while different
 * regional variants or different discs stay separate. Bundles are
 * sorted alphabetically by label; files within a bundle are sorted
 * alphabetically.
 */
export function bundleByVariant(files: string[]): FileBundle[] {
  const buckets = new Map<string, string[]>()
  for (const f of files) {
    const key = variantKey(f)
    const arr = buckets.get(key) ?? []
    arr.push(f)
    buckets.set(key, arr)
  }
  const out: FileBundle[] = []
  for (const [label, fs] of buckets) {
    const sorted = fs.slice().sort((a, b) => a.localeCompare(b))
    out.push({
      label,
      files: sorted,
      extensions: sorted.map(fileExt),
    })
  }
  out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return out
}

function pickHighestRev(in_: Parsed[]): string {
  let best = in_[0]
  let bestRev = revOf(best)
  for (let i = 1; i < in_.length; i++) {
    const r = revOf(in_[i])
    if (r > bestRev) {
      best = in_[i]
      bestRev = r
    }
  }
  return best.filename
}

/**
 * Variant-aware auto-select: bundle the input by `variantKey`, pick the
 * best variant using the same priority rules as `autoSelect` (Demo /
 * Proto excluded; preferences in order; Rev N tiebreak among the chosen
 * tag bucket), then return ALL files that belong to that variant.
 *
 * Each variant is represented to the priority logic by a single
 * "representative" file (one of its files); since the bundling key
 * already drops only multi-track markers, every file in a variant has
 * the same selection-relevant tags (region, demo/proto, rev), so any
 * representative gives the same answer. The variant whose representative
 * wins is the one whose files are returned in full.
 *
 * Returns [] when files is empty.
 */
export function autoSelectVariant(
  files: string[],
  preferences: readonly string[] = DEFAULT_PREFERENCES,
  lowPriorityTags: readonly string[] = DEFAULT_LOW_PRIORITY_TAGS,
): string[] {
  if (files.length === 0) return []
  const bundles = bundleByVariant(files)
  const repByLabel = new Map<string, string>()
  const reps: string[] = []
  for (const b of bundles) {
    repByLabel.set(b.label, b.files[0])
    reps.push(b.files[0])
  }
  const chosenRep = autoSelect(reps, preferences, lowPriorityTags)
  if (!chosenRep) return []
  const chosenLabel = variantKey(chosenRep)
  const chosenBundle = bundles.find((b) => b.label === chosenLabel)
  return chosenBundle ? chosenBundle.files.slice() : []
}
