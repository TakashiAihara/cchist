type Tok = { kind: "word"; text: string; subs: string[] } | { kind: "op" | "redir"; text: string };

// longest first, so `&&` is not read as two `&`
const OPS = ["&&", "||", ";;", ";&", "|&", ";", "|", "&", "(", ")", "\n"];
const REDIR = /^(\d*)(&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/;
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;
// words that only open or close a construct; the command follows (or there is none)
const RESERVED = new Set([
  "if",
  "then",
  "do",
  "while",
  "until",
  "else",
  "elif",
  "!",
  "time",
  "{",
  "}",
  "fi",
  "done",
]);

/**
 * The commands a shell command line runs, by name, in order: `cd x && git status |
 * head` gives cd, git, head; `SP=$(scratchpad) && cat "$SP"` gives scratchpad, cat.
 * Commands inside $( ), backticks and ( ) subshells count; assignments, redirect
 * targets, comments, heredoc bodies, `for` / `select` / `case` headers, case
 * patterns and function names do not. A wrapper (env, timeout, command, sudo) is
 * counted as itself: it is the program that runs, and seeing through it needs its
 * option syntax. `time` is a shell keyword, so it is skipped like `if`.
 */
export function commandNames(cmd: string): string[] {
  const names: string[] = [];
  let words: string[] = [];
  let target = false;
  let pattern = false;

  const finish = () => {
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      if (ASSIGN.test(w) || RESERVED.has(w)) continue;
      if (w === "esac") {
        pattern = false;
        continue;
      }
      if (w === "case") {
        pattern = true;
        break;
      }
      if (w === "function") {
        // `function f { ...`: the name is not a command, what follows the brace is
        i++;
        continue;
      }
      if (w === "for" || w === "select") break;
      // `"$(readlink -f x)" --version` runs what readlink printed: readlink is
      // already counted, and the program's name is not in the text
      const name = w.replace(/\$\((?:[^()]|\([^()]*\))*\)|`[^`]*`/g, "$(…)");
      if (name !== "$(…)") names.push(name);
      break;
    }
    words = [];
  };

  for (const t of lex(cmd)) {
    if (t.kind === "word") {
      for (const sub of t.subs) names.push(...commandNames(sub));
      if (target) target = false;
      else words.push(t.text);
    } else if (t.kind === "redir") {
      target = true;
    } else if (t.text === "(" && (words.length || pattern)) {
      // `name()` defines a function; `(pat)` opens a case pattern
      if (!pattern) words = [];
    } else if (t.text === ")" && pattern) {
      words = [];
      pattern = false;
    } else {
      finish();
      // `;;` only ends a case item, so a pattern comes next
      if (t.text === ";;" || t.text === ";&") pattern = true;
    }
  }
  finish();
  return names;
}

function lex(src: string): Tok[] {
  // a backslash-newline continues the line
  const s = src.replace(/\\\n/g, " ");
  const out: Tok[] = [];
  // delimiters of heredocs opened on the current line
  const heredocs: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (ch === "\n") {
      out.push({ kind: "op", text: "\n" });
      i++;
      // heredoc bodies start on the next line and end at their delimiter line
      for (const delim of heredocs.splice(0)) {
        while (i < s.length) {
          const end = s.indexOf("\n", i);
          const line = s.slice(i, end < 0 ? s.length : end);
          i = end < 0 ? s.length : end + 1;
          // trimmed, so a `<<-` body's tab-indented delimiter ends it too
          if (line.trim() === delim) break;
        }
      }
      continue;
    }
    const prev = out.at(-1);
    const atCommand =
      !prev ||
      prev.kind === "op" ||
      (prev.kind === "word" && (RESERVED.has(prev.text) || prev.text === "for"));
    if (s.startsWith("((", i) && atCommand) {
      // an arithmetic command runs nothing
      i = balanced(s, i + 1) + 1;
      continue;
    }
    const r = REDIR.exec(s.slice(i));
    if (r) {
      out.push({ kind: "redir", text: r[2]! });
      i += r[0].length;
      if (r[2] === "<<" || r[2] === "<<-") {
        while (s[i] === " " || s[i] === "\t") i++;
        const w = readWord(s, i);
        heredocs.push(w.text);
      }
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) {
      out.push({ kind: "op", text: op });
      i += op.length;
      continue;
    }
    const w = readWord(s, i);
    out.push({ kind: "word", text: w.text, subs: w.subs });
    i = w.end;
  }
  return out;
}

/** One word from `i`, unquoted, with the bodies of the $( ) and backtick substitutions in it. */
function readWord(s: string, i: number): { text: string; subs: string[]; end: number } {
  let text = "";
  const subs: string[] = [];
  const subst = (): boolean => {
    if (s.startsWith("$((", i)) {
      const end = balanced(s, i + 1);
      text += s.slice(i, end + 1);
      i = end + 1;
      return true;
    }
    if (s.startsWith("$(", i)) {
      const end = balanced(s, i + 1);
      subs.push(s.slice(i + 2, end));
      text += s.slice(i, end + 1);
      i = end + 1;
      return true;
    }
    if (s[i] === "`") {
      let end = i + 1;
      while (end < s.length && s[end] !== "`") end += s[end] === "\\" ? 2 : 1;
      subs.push(s.slice(i + 1, end));
      text += s.slice(i, end + 1);
      i = end + 1;
      return true;
    }
    return false;
  };

  while (i < s.length) {
    const ch = s[i]!;
    if (/[\s;&|()<>]/.test(ch)) break;
    if (ch === "\\") {
      text += s[i + 1] ?? "";
      i += 2;
    } else if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      const stop = end < 0 ? s.length : end;
      text += s.slice(i + 1, stop);
      i = stop + 1;
    } else if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") {
          text += s[i + 1] ?? "";
          i += 2;
        } else if (!subst()) text += s[i++];
      }
      i++;
    } else if (ch === "$" && s[i + 1] === "{") {
      const end = s.indexOf("}", i);
      const stop = end < 0 ? s.length - 1 : end;
      text += s.slice(i, stop + 1);
      i = stop + 1;
    } else if (!subst()) {
      text += ch;
      i++;
    }
  }
  return { text, subs, end: i };
}

/** Index of the ")" that closes the "(" at `open`, skipping quoted text and nested parens. */
function balanced(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\") i++;
    else if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      i = end < 0 ? s.length : end;
    } else if (ch === '"') {
      // a double-quoted string can hold \" and its own $( ), which may nest more quotes
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === "\\") i++;
        else if (s.startsWith("$(", i)) i = balanced(s, i + 1);
      }
    } else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return s.length;
}
