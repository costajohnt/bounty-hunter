import { writeFileSync, existsSync, mkdirSync, unlinkSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { loadConfig, getDataDir, getConfigPath } from "./config.js";
import type { WatchlistConfig } from "./types.js";

const PLIST_NAME = "com.bounty-hunter.monitor";

function getPlistDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

function getPlistPath(): string {
  return join(getPlistDir(), `${PLIST_NAME}.plist`);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function generatePlist(
  monitorScriptPath: string,
  intervalSeconds: number,
  nodePath: string = process.execPath
): string {
  const logPath = join(getDataDir(), "monitor.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(nodePath)}</string>
        <string>${escapeXml(monitorScriptPath)}</string>
    </array>
    <key>StartInterval</key>
    <integer>${intervalSeconds}</integer>
    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>`;
}

/**
 * Validates everything the launchd job needs BEFORE touching LaunchAgents,
 * so a broken install fails with a clear message instead of half-applied
 * state. Returns the loaded config on success.
 */
export function validateInstallPreconditions(
  monitorScriptPath: string
): WatchlistConfig {
  if (!existsSync(monitorScriptPath)) {
    throw new Error(
      `Monitor script not found at ${monitorScriptPath}. Run "npm run build" first.`
    );
  }

  let config: WatchlistConfig;
  try {
    config = loadConfig();
  } catch (err) {
    throw new Error(
      `Cannot install: watchlist config is missing or invalid ` +
        `(${err instanceof Error ? err.message : err}). ` +
        `Create ~/.bounty-hunter/watchlist.yml before installing.`
    );
  }

  // launchd jobs do not inherit your shell environment, so placeholders in
  // the YAML mean the monitor would run without Telegram credentials and
  // every notification would silently fail. Validate the RAW on-disk YAML:
  // loadConfig overlays TELEGRAM_* env vars from the installer's shell,
  // which the scheduled job will never see, so the overlaid values would
  // mask exactly the misconfiguration this check exists to catch.
  const rawYaml = parse(readFileSync(getConfigPath(), "utf-8")) as {
    telegram?: { bot_token?: unknown; chat_id?: unknown };
  };
  const placeholders = ["", "set-via-env"];
  const onDisk = [rawYaml.telegram?.bot_token, rawYaml.telegram?.chat_id];
  if (
    onDisk.some(
      (v) => typeof v !== "string" || placeholders.includes(v.trim())
    )
  ) {
    throw new Error(
      "Telegram credentials in watchlist.yml are missing or placeholders. " +
        "launchd jobs do not inherit your shell environment (TELEGRAM_* env " +
        "vars will not reach the scheduled job), so put the real bot_token " +
        "and chat_id in ~/.bounty-hunter/watchlist.yml (chmod 600) before installing."
    );
  }

  return config;
}

export function installLaunchd(monitorScriptPath: string): void {
  const config = validateInstallPreconditions(monitorScriptPath);
  const interval = (config.polling_interval ?? 5) * 60;
  const plistDir = getPlistDir();
  const plistPath = getPlistPath();

  mkdirSync(plistDir, { recursive: true });
  const plist = generatePlist(monitorScriptPath, interval);
  writeFileSync(plistPath, plist);

  // Unload if already loaded, then load
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["load", plistPath]);

  // launchctl load can exit 0 without the job sticking; verify it is listed
  try {
    execFileSync("launchctl", ["list", PLIST_NAME], { stdio: "ignore" });
  } catch {
    throw new Error(
      `launchctl load ran but ${PLIST_NAME} is not in launchctl list. ` +
        `Inspect the plist at ${plistPath} and try "launchctl load ${plistPath}" manually.`
    );
  }

  console.log(`Installed and loaded ${PLIST_NAME}`);
  console.log(`Polling every ${config.polling_interval} minutes`);
  console.log(`Logs: ${join(getDataDir(), "monitor.log")}`);
}

export function uninstallLaunchd(): void {
  const plistPath = getPlistPath();
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {}
  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }
  console.log(`Uninstalled ${PLIST_NAME}`);
}

// Entry point
const isMain = fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const action = process.argv[2];
  if (action === "install") {
    // monitor.js sits next to this compiled file in dist/, independent of cwd
    const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "monitor.js");
    installLaunchd(scriptPath);
  } else if (action === "uninstall") {
    uninstallLaunchd();
  } else {
    console.log("Usage: install-launchd <install|uninstall>");
  }
}
