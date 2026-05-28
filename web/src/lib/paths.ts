/**
 * Display helpers for source/destination directory paths. The backend
 * always hands us absolute, cleaned paths (POSIX-style on the platforms
 * we target), so a short label is just the trailing path segment.
 */

/**
 * Return the trailing segment of a directory path for compact display
 * (e.g. "/roms/console-a/usa" → "usa"). Trailing slashes are ignored. The
 * full path is the empty string's fallback so a label always renders.
 */
export function sourceLabel(path: string): string {
  if (!path) return ''
  const trimmed = path.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed
}
