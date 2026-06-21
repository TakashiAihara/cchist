import { describe, expect, test } from "bun:test";
import { parseRange, inAnyRange } from "../src/lib/ranges";

describe("parseRange", () => {
  test("single index with and without m prefix", () => {
    expect(parseRange("3")).toEqual({ start: 3, end: 3 });
    expect(parseRange("m3")).toEqual({ start: 3, end: 3 });
  });

  test("span with and without m prefix", () => {
    expect(parseRange("3..7")).toEqual({ start: 3, end: 7 });
    expect(parseRange("m3..m7")).toEqual({ start: 3, end: 7 });
  });

  test("normalizes reversed spans", () => {
    expect(parseRange("7..3")).toEqual({ start: 3, end: 7 });
  });

  test("rejects malformed tokens", () => {
    expect(parseRange("")).toBeNull();
    expect(parseRange("m")).toBeNull();
    expect(parseRange("3..")).toBeNull();
    expect(parseRange("..7")).toBeNull();
    expect(parseRange("1..2..3")).toBeNull();
    expect(parseRange("-1")).toBeNull();
    expect(parseRange("abc")).toBeNull();
    expect(parseRange("1.5")).toBeNull();
  });
});

describe("inAnyRange", () => {
  test("empty ranges matches everything", () => {
    expect(inAnyRange(0, [])).toBe(true);
    expect(inAnyRange(999, [])).toBe(true);
  });

  test("inclusive bounds", () => {
    const r = [{ start: 3, end: 5 }];
    expect(inAnyRange(2, r)).toBe(false);
    expect(inAnyRange(3, r)).toBe(true);
    expect(inAnyRange(5, r)).toBe(true);
    expect(inAnyRange(6, r)).toBe(false);
  });

  test("matches if any of multiple ranges contains n", () => {
    const r = [
      { start: 0, end: 1 },
      { start: 10, end: 12 },
    ];
    expect(inAnyRange(11, r)).toBe(true);
    expect(inAnyRange(5, r)).toBe(false);
  });
});
