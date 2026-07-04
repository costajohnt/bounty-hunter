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

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * Resolve a Node binary path that survives `brew upgrade node`.
 *
 * `process.execPath` resolves symlinks, so under Homebrew it is the
 * version-pinned Cellar path (e.g. /opt/homebrew/Cellar/node/26.0.0/bin/node).
 * Pinning that into the plist is a silent-death trap: the next `brew upgrade
 * node` deletes that directory and launchd can never spawn the job again.
 * When execPath is under a Homebrew Cellar, prefer the stable
 * `<brew-prefix>/bin/node` symlink (which Homebrew re-points on every upgrade)
 * if it exists; otherwise fall back to execPath unchanged.
 */
export function resolveDurableNodePath(execPath: string = process.execPath): string {
  const marker = "/Cellar/";
  const idx = execPath.indexOf(marker);
  if (idx === -1) return execPath;
  const brewPrefix = execPath.slice(0, idx); // e.g. /opt/homebrew or /usr/local
  const stable = join(brewPrefix, "bin", "node");
  return existsSync(stable) ? stable : execPath;
}

export function generatePlist(
  monitorScriptPath: string,
  intervalSeconds: number,
  nodePath: string = resolveDurableNodePath()
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

/**
 * Extract the ProgramArguments array (argv) from a generated plist. Pure so it
 * can be unit-tested without a real LaunchAgents file. Returns [] if the key or
 * array is absent.
 */
export function extractProgramArguments(plistXml: string): string[] {
  const keyIdx = plistXml.indexOf("<key>ProgramArguments</key>");
  if (keyIdx === -1) return [];
  const arrayStart = plistXml.indexOf("<array>", keyIdx);
  const arrayEnd = plistXml.indexOf("</array>", arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) return [];
  const block = plistXml.slice(arrayStart, arrayEnd);
  return [...block.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) =>
    unescapeXml(m[1])
  );
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

/**
 * Health check for the installed launchd job. The CRITICAL failure this exists
 * to catch: the plist's Node binary path no longer exists (e.g. after
 * `brew upgrade node` on an old install that pinned a Cellar path), so launchd
 * fails to spawn the job forever and the in-process heartbeat can never fire.
 */
export function doctor(): DoctorReport {
  const checks: DoctorCheck[] = [];
  const plistPath = getPlistPath();
  const plistExists = existsSync(plistPath);
  checks.push({
    name: "plist",
    ok: plistExists,
    detail: plistExists
      ? `present: ${plistPath}`
      : `missing: ${plistPath} — run "node dist/install-launchd.js install"`,
  });

  if (plistExists) {
    const [nodePath, scriptPath] = extractProgramArguments(
      readFileSync(plistPath, "utf-8")
    );

    const nodeOk = !!nodePath && existsSync(nodePath);
    checks.push({
      name: "node-path",
      ok: nodeOk,
      detail: nodeOk
        ? `Node binary exists: ${nodePath}`
        : `Node binary NOT found: ${nodePath ?? "(none in plist)"} — a "brew upgrade node" likely moved it. Re-run "node dist/install-launchd.js install" to re-point the plist.`,
    });

    const scriptOk = !!scriptPath && existsSync(scriptPath);
    checks.push({
      name: "monitor-script",
      ok: scriptOk,
      detail: scriptOk
        ? `monitor script exists: ${scriptPath}`
        : `monitor script NOT found: ${scriptPath ?? "(none in plist)"} — run "npm run build".`,
    });

    let loaded = false;
    try {
      execFileSync("launchctl", ["list", PLIST_NAME], { stdio: "ignore" });
      loaded = true;
    } catch {}
    checks.push({
      name: "launchd-loaded",
      ok: loaded,
      detail: loaded
        ? `${PLIST_NAME} is loaded`
        : `${PLIST_NAME} not in "launchctl list" — the job is not scheduled. Re-run install.`,
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
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
  } else if (action === "doctor") {
    const report = doctor();
    for (const c of report.checks) {
      console.log(`${c.ok ? "✅" : "❌"} ${c.name}: ${c.detail}`);
    }
    process.exit(report.ok ? 0 : 1);
  } else {
    console.log("Usage: install-launchd <install|uninstall|doctor>");
  }
}
