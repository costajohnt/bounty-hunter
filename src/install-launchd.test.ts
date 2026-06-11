import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generatePlist, validateInstallPreconditions } from "./install-launchd.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_HOME = "/tmp/bounty-hunter-test-launchd";

describe("generatePlist", () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("generates valid XML with correct label, interval, and paths", () => {
    const plist = generatePlist("/usr/local/bin/monitor.js", 300);
    expect(plist).toContain("<?xml version=\"1.0\"");
    expect(plist).toContain("<string>com.bounty-hunter.monitor</string>");
    expect(plist).toContain("<string>/usr/local/bin/monitor.js</string>");
    expect(plist).toContain("<integer>300</integer>");
  });

  it("contains the monitor script path", () => {
    const plist = generatePlist("/some/path/to/monitor.js", 600);
    expect(plist).toContain("<string>/some/path/to/monitor.js</string>");
  });

  it("contains the correct interval", () => {
    const plist = generatePlist("/path/monitor.js", 120);
    expect(plist).toContain("<integer>120</integer>");
  });

  it("escapes XML special characters in paths", () => {
    const plist = generatePlist("/path/with<special>&chars>here.js", 300);
    expect(plist).toContain("&amp;");
    expect(plist).toContain("&lt;");
    expect(plist).toContain("&gt;");
    expect(plist).not.toContain("<special>");
    expect(plist).not.toContain("&chars>");
  });

  it("uses the absolute node binary instead of a bare PATH lookup", () => {
    const plist = generatePlist("/path/monitor.js", 300);
    expect(plist).toContain(`<string>${process.execPath}</string>`);
    expect(plist).not.toContain("<string>node</string>");
  });

  it("accepts an explicit node path", () => {
    const plist = generatePlist("/path/monitor.js", 300, "/custom/node");
    expect(plist).toContain("<string>/custom/node</string>");
  });
});

describe("validateInstallPreconditions", () => {
  let originalHome: string | undefined;
  const scriptPath = join(TEST_HOME, "monitor.js");

  function writeConfig(botToken: string, chatId: string): void {
    const dataDir = join(TEST_HOME, ".bounty-hunter");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "watchlist.yml"),
      `
polling_interval: 5
telegram:
  bot_token: "${botToken}"
  chat_id: "${chatId}"
sources:
  repos: []
`
    );
  }

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });
    writeFileSync(scriptPath, "// compiled monitor");
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("passes with a real config and existing script", () => {
    writeConfig("123456:real-token", "987654");
    const config = validateInstallPreconditions(scriptPath);
    expect(config.polling_interval).toBe(5);
  });

  it("rejects a missing monitor script with build guidance", () => {
    writeConfig("123456:real-token", "987654");
    expect(() => validateInstallPreconditions(join(TEST_HOME, "nope.js"))).toThrow(
      /npm run build/
    );
  });

  it("rejects a missing config before touching anything", () => {
    expect(() => validateInstallPreconditions(scriptPath)).toThrow(/watchlist/);
  });

  it("rejects placeholder telegram credentials", () => {
    writeConfig("set-via-env", "set-via-env");
    expect(() => validateInstallPreconditions(scriptPath)).toThrow(
      /do not inherit/
    );
  });

  it("rejects empty telegram credentials", () => {
    writeConfig("", "987654");
    expect(() => validateInstallPreconditions(scriptPath)).toThrow(
      /do not inherit/
    );
  });

  it("rejects placeholder YAML even when TELEGRAM_* env vars are exported", () => {
    // The installer's shell env never reaches the launchd job, so exported
    // tokens must not mask a placeholder config (loadConfig overlays them)
    writeConfig("set-via-env", "set-via-env");
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    const prevChat = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "123456:real-token-from-shell";
    process.env.TELEGRAM_CHAT_ID = "987654";
    try {
      expect(() => validateInstallPreconditions(scriptPath)).toThrow(
        /do not inherit/
      );
    } finally {
      if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = prevToken;
      if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
      else process.env.TELEGRAM_CHAT_ID = prevChat;
    }
  });

  it("rejects whitespace-only credentials", () => {
    writeConfig("   ", "987654");
    expect(() => validateInstallPreconditions(scriptPath)).toThrow(
      /do not inherit/
    );
  });
});
