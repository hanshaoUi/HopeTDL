export function quoteShellArg(value, windows = false) {
  const s = value == null ? '' : String(value)
  if (s && (windows ? /^[a-zA-Z0-9_./:+=-]+$/ : /^[a-zA-Z0-9_./:@%+=,-]+$/).test(s)) return s
  return windows ? "'" + s.replaceAll("'", "''") + "'" : "'" + s.replaceAll("'", "'\"'\"'") + "'"
}
