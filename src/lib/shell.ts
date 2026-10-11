type Tok = { kind: "word"; text: string; subs: string[] } | { kind: "op" | "redir"; text: string };

// longest first, so `&&` is not read as two `&`
const OPS = ["&&", "||", ";;", ";&", "|&", ";", "|", "&", "(", ")", "\n"];
// sticky: matched at an index, so a long command is not copied per token
const REDIR = /(\d*)(&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/y;
// substitutions in a command word nest deeper than this only in generated input
const MAX_DEPTH = 32;
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
 * The commands a shell command line runs, by name: `cd x && git status | head`
 * gives cd, git, head; `SP=$(scratchpad) && cat "$SP"` gives scratchpad, cat (a
 * substitution's commands come before the command whose word holds it).
 * Commands inside $( ), backticks and ( ) subshells count; assignments, redirect
 * targets, comments, heredoc bodies, `for` / `select` / `case` headers, case
 * patterns and function names do not. A wrapper (env, timeout, command, sudo) is
 * counted as itself: it is the program that runs, and seeing through it needs its
 * option syntax. `time` is a shell keyword, so it is skipped like `if`.
 */
export function commandNames(cmd: string, depth = 0): string[] {
  const names: string[] = [];
  let words: string[] = [];
  let target = false;
  let pattern = false;

  // inside an unclosed [[ ]]
  const inTest = () => words[0] === "[[" && !words.includes("]]");

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
      const name = maskSubs(w);
      if (name !== "$(…)") names.push(name);
      break;
    }
    words = [];
  };

  const toks = lex(cmd);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.kind === "word") {
      if (depth < MAX_DEPTH)
        for (const sub of t.subs) for (const n of commandNames(sub, depth + 1)) names.push(n);
      if (target) target = false;
      else words.push(t.text);
    } else if (t.kind === "redir") {
      target = true;
    } else if (t.text === "(" && pattern) {
      // `(pat)` opens a case pattern
    } else if (t.text === "(" && words.length && words.every((w) => RESERVED.has(w))) {
      // `time (a; b)` / `! (a)`: a subshell after a keyword
      words = [];
    } else if (t.text === "(" && words.length) {
      const next = toks[k + 1];
      if (next?.kind === "op" && next.text === ")") {
        // `name()` defines a function: the name is not a command
        words = [];
        k++;
        continue;
      }
      // `xs=(a b)` is an array and `*.zip(N)` a zsh glob qualifier: neither runs a command
      for (let open = 1; open && k + 1 < toks.length; ) {
        const u = toks[++k]!;
        if (u.kind === "op" && u.text === "(") open++;
        else if (u.kind === "op" && u.text === ")") open--;
      }
    } else if (t.text === ")" && pattern) {
      words = [];
      pattern = false;
    } else if (t.text === "|" && pattern) {
      // `a|b)`: another alternative of the same pattern
    } else if ((t.text === "&&" || t.text === "||") && inTest()) {
      // a condition inside [[ ]], not a new command
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
  // heredocs opened on the current line
  const heredocs: { delim: string; tabs: boolean }[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch !== "\n" && /\s/.test(ch)) {
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
      for (const h of heredocs.splice(0)) i = skipBody(s, i, h.delim, h.tabs);
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
    if ((ch === "<" || ch === ">") && s[i + 1] === "(") {
      // a process substitution runs its commands; the word is a file name
      const end = balanced(s, i + 1);
      out.push({ kind: "word", text: `${ch}(…)`, subs: [s.slice(i + 2, end)] });
      i = end + 1;
      continue;
    }
    REDIR.lastIndex = i;
    const r = REDIR.exec(s);
    if (r) {
      out.push({ kind: "redir", text: r[2]! });
      i += r[0].length;
      if (r[2] === "<<" || r[2] === "<<-") {
        while (s[i] === " " || s[i] === "\t") i++;
        const w = readWord(s, i);
        heredocs.push({ delim: w.text, tabs: r[2] === "<<-" });
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
    // a word always moves on, so no input can stall the loop
    i = Math.max(w.end, i + 1);
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
      // ${x:-$(cmd)}: the default runs cmd, and the `}` inside it is not the end
      const start = i;
      let depth = 0;
      while (i < s.length) {
        const c = s[i]!;
        if (c === "\\") i += 2;
        else if (c === "'") {
          const e = s.indexOf("'", i + 1);
          i = e < 0 ? s.length : e + 1;
        } else if (c === "$" && s[i + 1] === "(") {
          const e = balanced(s, i + 1);
          if (s[i + 2] !== "(") subs.push(s.slice(i + 2, e));
          i = e + 1;
        } else if (c === "`") {
          let e = i + 1;
          while (e < s.length && s[e] !== "`") e += s[e] === "\\" ? 2 : 1;
          subs.push(s.slice(i + 1, e));
          i = e + 1;
        } else {
          i++;
          if (c === "{") depth++;
          else if (c === "}" && --depth === 0) break;
        }
      }
      text += s.slice(start, i);
    } else if (!subst()) {
      text += ch;
      i++;
    }
  }
  return { text, subs, end: i };
}

/** `w` with each substitution, however nested, shown as `$(…)`. */
function maskSubs(w: string): string {
  let out = "";
  for (let i = 0; i < w.length; i++) {
    if (w.startsWith("$(", i)) {
      i = balanced(w, i + 1);
      out += "$(…)";
    } else if (w[i] === "`") {
      const e = w.indexOf("`", i + 1);
      i = e < 0 ? w.length : e;
      out += "$(…)";
    } else out += w[i];
  }
  return out;
}

/**
 * Index just past a heredoc body that starts at `i`: past the line that is the
 * delimiter (after leading tabs for `<<-`, as bash strips them; a trailing \r is
 * ignored too).
 */
function skipBody(s: string, i: number, delim: string, tabs: boolean): number {
  while (i < s.length) {
    const end = s.indexOf("\n", i);
    const line = s.slice(i, end < 0 ? s.length : end).replace(/\r$/, "");
    i = end < 0 ? s.length : end + 1;
    if ((tabs ? line.replace(/^\t+/, "") : line) === delim) break;
  }
  return i;
}

// a heredoc opened inside $( ): `<<'EOF'` / `<<-EOF` / `<< "EOF"`
const HEREDOC = /<<(-?)[ \t]*(['"]?)([^\s'"();&|<>]+)\2/y;

/**
 * Index of the ")" that closes the "(" at `open`, skipping quoted text, nested
 * parens and heredoc bodies (a commit message in $(cat <<'EOF' ...) has quotes).
 */
function balanced(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i]!;
    HEREDOC.lastIndex = i;
    const h = ch === "<" && s[i + 2] !== "<" ? HEREDOC.exec(s) : null;
    if (h) {
      const nl = s.indexOf("\n", i);
      if (nl < 0) return s.length;
      i = skipBody(s, nl + 1, h[3]!, h[1] === "-") - 1;
      continue;
    }
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
