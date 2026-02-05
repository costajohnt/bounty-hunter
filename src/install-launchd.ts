import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, getDataDir } from "./config.js";

const PLIST_NAME = "com.bounty-hunter.monitor";
const PLIST_DIR = join(process.env.HOME ?? "~", "Library", "LaunchAgents");
const PLIST_PATH = join(PLIST_DIR, `${PLIST_NAME}.plist`);

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
        <string>${monitorScriptPath}</string>
    </array>
    <key>StartInterval</key>
    <integer>${intervalSeconds}</integer>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
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

  mkdirSync(PLIST_DIR, { recursive: true });
  const plist = generatePlist(monitorScriptPath, interval);
  writeFileSync(PLIST_PATH, plist);

  // Unload if already loaded, then load
  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["load", PLIST_PATH]);

  console.log(`Installed and loaded ${PLIST_NAME}`);
  console.log(`Polling every ${config.polling_interval} minutes`);
  console.log(`Logs: ${join(getDataDir(), "monitor.log")}`);
}

export function uninstallLaunchd(): void {
  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
  } catch {}
  if (existsSync(PLIST_PATH)) {
    unlinkSync(PLIST_PATH);
  }
  console.log(`Uninstalled ${PLIST_NAME}`);
}

// Entry point
const isMain = import.meta.url === `file://${process.argv[1]}`;
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
