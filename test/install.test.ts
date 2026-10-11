import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// a stand-in binary: install.sh smoke-tests it with --version
const FAKE = "#!/bin/sh\necho 9.9.9\n";
const ASSETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"].map((p) => `cchist-${p}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let root: string;

/** Lay out a release dir the way GitHub serves it, with or without checksums. */
function release(dir: string, sum: "good" | "bad" | "none"): void {
  mkdirSync(dir, { recursive: true });
  for (const a of ASSETS) {
    writeFileSync(join(dir, a), FAKE);
    if (sum === "good") writeFileSync(join(dir, `${a}.sha256`), `${sha(FAKE)}  ${a}\n`);
    if (sum === "bad") writeFileSync(join(dir, `${a}.sha256`), `${sha("other")}  ${a}\n`);
  }
}

function install(base: string, version?: string): { code: number; stderr: string; dir: string } {
  const dir = mkdtempSync(join(root, "bin-"));
  const r = Bun.spawnSync(["sh", join(import.meta.dir, "..", "install.sh")], {
    env: {
      ...process.env,
      CCHIST_DOWNLOAD_BASE: `file://${base}`,
      CCHIST_INSTALL_DIR: dir,
      ...(version ? { CCHIST_VERSION: version } : {}),
    },
  });
  return { code: r.exitCode, stderr: r.stderr.toString(), dir };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-install-"));
  release(join(root, "good", "latest", "download"), "good");
  release(join(root, "bad", "latest", "download"), "bad");
  release(join(root, "none", "latest", "download"), "none");
  release(join(root, "old", "download", "v0.1.0"), "none");
  release(join(root, "badpin", "download", "v0.3.0"), "bad");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("install.sh checksum", () => {
  test("a matching checksum installs", () => {
    const r = install(join(root, "good"));
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("checksum: ok");
    expect(existsSync(join(r.dir, "cchist"))).toBe(true);
  });

  test("a mismatch refuses to install", () => {
    const r = install(join(root, "bad"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("checksum mismatch");
    expect(existsSync(join(r.dir, "cchist"))).toBe(false);
  });

  test("latest without a checksum refuses to install", () => {
    const r = install(join(root, "none"));
    expect(r.code).toBe(1);
    expect(existsSync(join(r.dir, "cchist"))).toBe(false);
  });

  test("an old pinned tag without a checksum installs with a warning", () => {
    const r = install(join(root, "old"), "v0.1.0");
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("warning: v0.1.0 has no published checksum");
  });

  test("a pinned tag with a wrong checksum still refuses", () => {
    const r = install(join(root, "badpin"), "0.3.0");
    expect(r.code).toBe(1);
    expect(existsSync(join(r.dir, "cchist"))).toBe(false);
  });
});
