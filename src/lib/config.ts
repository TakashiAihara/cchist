import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "./format";
import { type CommonFilter } from "./types";

export type ExcludeRules = { cwd: string[]; entrypoint: string[] };
export type Config = { exclude: ExcludeRules };

/** XDG-aware config path; `CCHIST_CONFIG` overrides it outright. */
export function configPath(): string {
  if (process.env.CCHIST_CONFIG) return process.env.CCHIST_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "cchist", "config.json");
}

function emptyConfig(): Config {
  return { exclude: { cwd: [], entrypoint: [] } };
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Load the config file. Missing file -> empty config (cchist excludes nothing by
 * default). Invalid JSON is reported on stderr and treated as empty, so a broken
 * config never breaks a query.
 */
export function loadConfig(path = configPath()): Config {
  if (!existsSync(path)) return emptyConfig();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const ex = raw?.exclude ?? {};
    return { exclude: { cwd: strArray(ex.cwd), entrypoint: strArray(ex.entrypoint) } };
  } catch (e) {
    log(`cchist: ignoring invalid config at ${path}: ${e instanceof Error ? e.message : e}`);
    return emptyConfig();
  }
}

/** Merge config-file exclude rules into the CLI filter (CLI flags ∪ config). */
export function withConfigExcludes(opts: CommonFilter, cfg = loadConfig()): CommonFilter {
  return {
    ...opts,
    excludeCwd: [...(opts.excludeCwd ?? []), ...cfg.exclude.cwd],
    excludeEntrypoint: [...(opts.excludeEntrypoint ?? []), ...cfg.exclude.entrypoint],
  };
}
