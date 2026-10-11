import type { Usage } from "./types";

/**
 * USD per million tokens: base input, 5-minute cache write, 1-hour cache write,
 * cache read, output. Copied from https://platform.claude.com/docs/en/about-claude/pricing
 * on 2026-10-11; prices change, so update this table from that page, not from memory.
 *
 * shortcut: fast mode (`usage.speed: "fast"`), US-only inference (`inference_geo:
 * "us"`, 1.1x), Claude Haiku 5.5's prompts over 100k tokens and web search / fetch
 * fees are not priced; none of them occur in the transcripts seen so far. Price
 * them here when they do.
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
  "claude-haiku-3-5": [0.8, 1, 1.6, 0.08, 4],
};

/** USD for one call, or null when the model is not in the table. */
export function callCost(model: string | null, u: Usage): number | null {
  // a dated snapshot (claude-haiku-4-5-20251001) is priced as its model
  const p = model ? PRICES[model.replace(/-\d{8}$/, "")] : undefined;
  // a synthetic reply (no model) carries no tokens, so it costs nothing either way
  if (!p) return u.input + u.output + u.cacheRead + u.cacheCreate ? null : 0;
  const [input, write5m, write1h, read, output] = p;
  const tokens =
    u.input * input +
    (u.cacheCreate - u.cacheCreate1h) * write5m +
    u.cacheCreate1h * write1h +
    u.cacheRead * read +
    u.output * output;
  return tokens / 1e6;
}
