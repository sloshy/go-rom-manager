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
  return p.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
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

export function autoSelect(
  files: string[],
  preferences: readonly string[] = DEFAULT_PREFERENCES,
): string {
  if (files.length === 0) return ''
  const parsed = files.map(parseName)
  const playable = parsed.filter((p) => !hasTag(p, 'Demo') && !hasTag(p, 'Proto'))
  const candidates = playable.length > 0 ? playable : parsed

  for (const tag of preferences) {
    if (!tag) continue
    const matched = candidates.filter((p) => hasTag(p, tag))
    if (matched.length > 0) return pickHighestRev(matched)
  }
  return pickHighestRev(candidates)
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
