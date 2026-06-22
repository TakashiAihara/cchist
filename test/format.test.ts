import { describe, expect, test } from "bun:test";
import { fmtNum, fmtK, fmtDuration, trunc, table } from "../src/lib/format";

describe("fmtNum", () => {
  test("groups thousands", () => {
    expect(fmtNum(1234567)).toBe("1,234,567");
    expect(fmtNum(0)).toBe("0");
  });
});

describe("fmtK", () => {
  test("formats with k / M suffixes above thresholds", () => {
    expect(fmtK(999)).toBe("999");
    expect(fmtK(1500)).toBe("1.5k");
    expect(fmtK(2_500_000)).toBe("2.5M");
  });
});

describe("fmtDuration", () => {
  test("returns - for zero or negative", () => {
    expect(fmtDuration(0)).toBe("-");
    expect(fmtDuration(-5)).toBe("-");
  });

  test("formats seconds, minutes, and hours", () => {
    expect(fmtDuration(45_000)).toBe("45s");
    expect(fmtDuration(125_000)).toBe("2m5s");
    expect(fmtDuration(3_900_000)).toBe("1h5m");
  });
});

describe("trunc", () => {
  test("leaves short strings untouched", () => {
    expect(trunc("hello", 10)).toBe("hello");
  });

  test("truncates from the right by default", () => {
    expect(trunc("abcdefgh", 5)).toBe("abcd…");
  });

  test("truncates from the left when asked", () => {
    expect(trunc("abcdefgh", 5, "left")).toBe("…efgh");
  });
});

describe("table", () => {
  test("pads columns to the widest cell and adds a separator row", () => {
    const out = table(
      ["name", "n"],
      [
        ["a", "1"],
        ["bbb", "22"],
      ],
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(4); // header, separator, 2 rows
    expect(lines[0]).toBe("name  n");
    expect(lines[1]).toBe("----  --"); // 2nd col width is 2 ("22")
    expect(lines[2]).toBe("a     1");
    expect(lines[3]).toBe("bbb   22");
  });
});
