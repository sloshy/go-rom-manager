/**
 * Pure helpers that mirror the Go `internal/games` package: parse a ROM
 * filename into prefix + tags, group files by prefix (honouring manual
 * overrides), and pick the best variant of a multi-file game group.
 */

export interface Parsed {
  filename: string;
  prefix: string;
  tags: string[];
}

export interface GameGroup {
  prefix: string;
  files: string[];
}

const KNOWN_EXTS = [".zip", ".7z", ".rar", ".bin", ".smc", ".sfc", ".gen", ".md", ".n64", ".z64", ".nes"];

function trimExt(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of KNOWN_EXTS) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot <= 5) return name.slice(0, dot);
  return name;
}

export function parseName(filename: string): Parsed {
  const base = trimExt(filename);
  const cut = base.indexOf("(");
  const prefix = (cut >= 0 ? base.slice(0, cut) : base).trim();
  const tags: string[] = [];
  const re = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(base)) !== null) tags.push(m[1].trim());
  return { filename, prefix, tags };
}

export function hasTag(p: Parsed, tag: string): boolean {
  return p.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
}

export function groupFiles(files: string[], manualGroups: Record<string, string> = {}): GameGroup[] {
  const buckets = new Map<string, string[]>();
  for (const f of files) {
    const override = manualGroups[f];
    const prefix = override && override.length > 0 ? override : parseName(f).prefix;
    const arr = buckets.get(prefix) ?? [];
    arr.push(f);
    buckets.set(prefix, arr);
  }
  const out: GameGroup[] = [];
  for (const [prefix, fs] of buckets) {
    out.push({ prefix, files: fs.slice().sort((a, b) => a.localeCompare(b)) });
  }
  out.sort((a, b) => a.prefix.localeCompare(b.prefix, undefined, { sensitivity: "base" }));
  return out;
}

const REV_RE = /^Rev\s*(\d+)$/i;

function revOf(p: Parsed): number {
  let highest = 0;
  for (const t of p.tags) {
    const m = REV_RE.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n > highest) highest = n;
    }
  }
  return highest;
}

export const DEFAULT_PREFERENCES: readonly string[] = ["USA", "World"];

export function autoSelect(files: string[], preferences: readonly string[] = DEFAULT_PREFERENCES): string {
  if (files.length === 0) return "";
  const parsed = files.map(parseName);
  const playable = parsed.filter((p) => !hasTag(p, "Demo") && !hasTag(p, "Proto"));
  const candidates = playable.length > 0 ? playable : parsed;

  for (const tag of preferences) {
    if (!tag) continue;
    const matched = candidates.filter((p) => hasTag(p, tag));
    if (matched.length > 0) return pickHighestRev(matched);
  }
  return pickHighestRev(candidates);
}

function pickHighestRev(in_: Parsed[]): string {
  let best = in_[0];
  let bestRev = revOf(best);
  for (let i = 1; i < in_.length; i++) {
    const r = revOf(in_[i]);
    if (r > bestRev) {
      best = in_[i];
      bestRev = r;
    }
  }
  return best.filename;
}
