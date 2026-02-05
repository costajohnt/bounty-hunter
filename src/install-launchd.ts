import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { loadConfig, getDataDir } from "./config.js";

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

export function generatePlist(monitorScriptPath: string, intervalSeconds: number): string {
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
        <string>node</string>
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

export function installLaunchd(monitorScriptPath: string): void {
  const config = loadConfig();
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
    const scriptPath = join(process.cwd(), "dist", "monitor.js");
    installLaunchd(scriptPath);
  } else if (action === "uninstall") {
    uninstallLaunchd();
  } else {
    console.log("Usage: install-launchd <install|uninstall>");
  }
}
