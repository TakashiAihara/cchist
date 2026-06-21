/**
 * Convert a simple glob into an anchored RegExp. Only `*` (any run) and `?`
 * (single char) are special; every other character is matched literally. Kept
 * dependency-free on purpose — patterns here only ever match cwd / entrypoint
 * strings, so full glob semantics (globstar, brace, character classes) are not
 * needed.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    // escape every regex metachar except * / ? which we handle above
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}
