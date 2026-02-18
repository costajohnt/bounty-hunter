import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { WatchlistConfigSchema } from "./types.js";
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
  const parsed = parse(raw);

  // Allow env vars to override Telegram secrets (for CI/GitHub Actions)
  if (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID) {
    parsed.telegram = parsed.telegram ?? {};
    if (process.env.TELEGRAM_BOT_TOKEN) parsed.telegram.bot_token = process.env.TELEGRAM_BOT_TOKEN;
    if (process.env.TELEGRAM_CHAT_ID) parsed.telegram.chat_id = process.env.TELEGRAM_CHAT_ID;
  }

  return WatchlistConfigSchema.parse(parsed);
}

export function ensureDataDir(baseDir?: string): void {
  const dir = baseDir ?? getDataDir();
  const dirs = [dir, join(dir, "proposals"), join(dir, "clones"), join(dir, "templates")];
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
  }
}
