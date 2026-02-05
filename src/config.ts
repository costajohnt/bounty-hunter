import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { WatchlistConfig } from "./types.js";

export function getDataDir(): string {
  return join(process.env.HOME ?? "~", ".bounty-hunter");
}

export function getConfigPath(): string {
  return join(getDataDir(), "watchlist.yml");
}

export function loadConfig(path?: string): WatchlistConfig {
  const configPath = path ?? getConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}. Run /watchlist to set up.`);
  }
  const raw = readFileSync(configPath, "utf-8");
  return parse(raw) as WatchlistConfig;
}

export function ensureDataDir(baseDir?: string): void {
  const dir = baseDir ?? getDataDir();
  const dirs = [dir, join(dir, "proposals"), join(dir, "clones"), join(dir, "templates")];
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
  }
}
