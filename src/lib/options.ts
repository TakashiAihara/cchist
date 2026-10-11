import { invalidInput } from "./errors";

/**
 * A whole-number option (`--top`, `--limit`, ...) at least `min`, or `fallback`
 * when unset. Anything else exits 3, rather than `parseInt` turning `x` into NaN
 * (an empty table) or `-1` into a slice that silently drops a row.
 */
export function intOption(
  value: string | undefined,
  flag: string,
  fallback: number,
  min = 1,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min) {
    throw invalidInput(`invalid ${flag}: ${value} (use a whole number, ${min} or more)`);
  }
  return Number(value);
}
