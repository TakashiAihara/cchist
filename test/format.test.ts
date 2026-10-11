import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fmtNum, fmtK, fmtDuration, fmtTs, trunc, table } from "../src/lib/format";

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
  // A high surrogate not followed by a low one, or the reverse, i.e. half an emoji
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  test("leaves short strings untouched", () => {
    expect(trunc("hello", 10)).toBe("hello");
  });

  test("truncates from the right by default", () => {
    expect(trunc("abcdefgh", 5)).toBe("abcd…");
  });

  test("truncates from the left when asked", () => {
    expect(trunc("abcdefgh", 5, "left")).toBe("…efgh");
  });

  test("a right cut landing on an emoji keeps both halves of the pair", () => {
    const cut = trunc("ab🌈cd", 4);
    expect(cut).toBe("ab🌈…");
    expect(LONE_SURROGATE.test(cut)).toBe(false);
  });

  test("a left cut landing on an emoji keeps both halves of the pair", () => {
    const cut = trunc("ab🌈cd", 4, "left");
    expect(cut).toBe("…🌈cd");
    expect(LONE_SURROGATE.test(cut)).toBe(false);
  });

  test("a string that fits by code points is left untouched", () => {
    expect(trunc("ab🌈cd", 5)).toBe("ab🌈cd");
    expect(trunc("ab🌈cd", 5, "left")).toBe("ab🌈cd");
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

describe("fmtTs", () => {
  // the zone is read at process start, so each case runs in a child with its own TZ
  function inZone(tz: string, expr: string): string {
    const r = Bun.spawnSync(
      ["bun", "-e", `import { fmtTs } from "./src/lib/format"; console.log(${expr});`],
      { cwd: join(import.meta.dir, ".."), env: { ...process.env, TZ: tz } },
    );
    return r.stdout.toString().trim();
  }

  test("renders local time to the minute with the offset", () => {
    expect(inZone("Asia/Tokyo", 'fmtTs("2026-10-01T03:25:59.123Z")')).toBe(
      "2026-10-01 12:25+09:00",
    );
  });

  test("UTC gets +00:00", () => {
    expect(inZone("UTC", 'fmtTs("2026-10-01T03:25:59.123Z")')).toBe("2026-10-01 03:25+00:00");
  });

  test("a negative half-hour offset crosses back a day", () => {
    expect(inZone("America/St_Johns", 'fmtTs("2026-10-01T01:00:00Z")')).toBe(
      "2026-09-30 22:30-02:30",
    );
  });

  test("an input offset is converted to the local zone", () => {
    expect(inZone("UTC", 'fmtTs("2026-10-01T12:25:00+09:00")')).toBe("2026-10-01 03:25+00:00");
  });

  test("includes seconds when asked", () => {
    expect(inZone("Asia/Tokyo", 'fmtTs("2026-10-01T03:25:59.123Z", true)')).toBe(
      "2026-10-01 12:25:59+09:00",
    );
  });

  test("absent or invalid timestamps render as -", () => {
    expect(fmtTs(null)).toBe("-");
    expect(fmtTs("nope")).toBe("-");
  });
});
