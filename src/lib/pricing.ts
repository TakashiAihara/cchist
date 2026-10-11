import type { Usage } from "./types";

/**
 * USD per million tokens: base input, 5-minute cache write, 1-hour cache write,
 * cache read, output. Copied from https://platform.claude.com/docs/en/about-claude/pricing
 * on 2026-10-11; prices change, so update this table from that page, not from memory.
 *
 * shortcut: fast mode and US-only inference (a call's `surcharge`) are left unpriced
 * rather than billed at the list price; web search / fetch fees and the first,
 * refused iteration of a fallback call are not priced. None of these occur in the
 * transcripts seen so far, beyond one fallback call. Price them here when they do.
 */
const PRICES: Record<string, [number, number, number, number, number]> = {
  "claude-fable-5-1": [10, 12.5, 20, 0.25, 50],
  "claude-mythos-5-1": [10, 12.5, 20, 0.25, 50],
  "claude-fable-5": [10, 12.5, 20, 1, 50],
  "claude-mythos-5": [10, 12.5, 20, 1, 50],
  "claude-opus-5-5": [4, 5, 8, 0.2, 20],
  "claude-opus-5": [5, 6.25, 10, 0.5, 25],
  "claude-opus-4-8": [5, 6.25, 10, 0.5, 25],
  "claude-opus-4-7": [5, 6.25, 10, 0.5, 25],
  "claude-opus-4-6": [5, 6.25, 10, 0.5, 25],
  "claude-opus-4-5": [5, 6.25, 10, 0.5, 25],
  "claude-opus-4-1": [15, 18.75, 30, 1.5, 75],
  "claude-opus-4": [15, 18.75, 30, 1.5, 75],
  "claude-sonnet-5-5": [2, 2.5, 4, 0.1, 10],
  "claude-sonnet-5": [2, 2.5, 4, 0.2, 10],
  "claude-sonnet-4-6": [3, 3.75, 6, 0.3, 15],
  "claude-sonnet-4-5": [3, 3.75, 6, 0.3, 15],
  "claude-sonnet-4": [3, 3.75, 6, 0.3, 15],
  "claude-haiku-4-5": [1, 1.25, 2, 0.1, 5],
  // the 3.x generation puts the family last: claude-3-5-haiku-20241022
  "claude-3-5-haiku": [0.8, 1, 1.6, 0.08, 4],
};

// Claude Haiku 5.5 pays more once a request's prompt (input + cache reads and
// writes) passes 100,000 tokens
const HAIKU_5_5: [number, number, number, number, number] = [0.1, 0.125, 0.2, 0.01, 0.5];
const HAIKU_5_5_LONG: [number, number, number, number, number] = [0.5, 0.625, 1, 0.05, 2.5];

/** USD for one call, or null when the model is not in the table or has a surcharge. */
export function callCost(
  model: string | null,
  u: Usage,
  surcharge: string | null = null,
): number | null {
  if (surcharge) return null;
  // a dated snapshot (claude-haiku-4-5-20251001) is priced as its model
  const name = model?.replace(/-\d{8}$/, "");
  const prompt = u.input + u.cacheRead + u.cacheCreate;
  const p =
    name === "claude-haiku-5-5"
      ? prompt > 100_000
        ? HAIKU_5_5_LONG
        : HAIKU_5_5
      : name && Object.hasOwn(PRICES, name)
        ? PRICES[name]
        : undefined;
  // a synthetic reply (no model) carries no tokens, so it costs nothing either way
  if (!p) return prompt + u.output ? null : 0;
  const [input, write5m, write1h, read, output] = p;
  const tokens =
    u.input * input +
    (u.cacheCreate - u.cacheCreate1h) * write5m +
    u.cacheCreate1h * write1h +
    u.cacheRead * read +
    u.output * output;
  // a count that is not a number at all (a hand-edited or foreign transcript) gives
  // NaN, which is no price
  return Number.isFinite(tokens) ? tokens / 1e6 : null;
}
