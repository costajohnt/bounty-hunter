import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generatePlist,
  validateInstallPreconditions,
  resolveDurableNodePath,
  extractProgramArguments,
  doctor,
} from "./install-launchd.js";
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

  it("uses a durable absolute node binary instead of a bare PATH lookup", () => {
    const plist = generatePlist("/path/monitor.js", 300);
    expect(plist).toContain(`<string>${resolveDurableNodePath()}</string>`);
    expect(plist).not.toContain("<string>node</string>");
  });

  it("does not embed a version-pinned Homebrew Cellar node path by default", () => {
    // The CRITICAL finding: pinning /opt/homebrew/Cellar/node/<version>/bin/node
    // means `brew upgrade node` silently kills the launchd job forever. When the
    // stable brew symlink exists, the default must not point inside Cellar.
    const durable = resolveDurableNodePath();
    if (!durable.includes("/Cellar/")) {
      const plist = generatePlist("/path/monitor.js", 300);
      expect(plist).not.toContain("/Cellar/");
    }
  });

  it("accepts an explicit node path", () => {
    const plist = generatePlist("/path/monitor.js", 300, "/custom/node");
    expect(plist).toContain("<string>/custom/node</string>");
  });
});

describe("resolveDurableNodePath", () => {
  it("returns a non-Homebrew path unchanged", () => {
    expect(resolveDurableNodePath("/usr/bin/node")).toBe("/usr/bin/node");
    expect(resolveDurableNodePath("/some/nvm/versions/node/v22/bin/node")).toBe(
      "/some/nvm/versions/node/v22/bin/node"
    );
  });

  it("maps a Homebrew Cellar path to the stable symlink when it exists", () => {
    const prefix = "/tmp/bounty-hunter-durable-node";
    mkdirSync(join(prefix, "bin"), { recursive: true });
    writeFileSync(join(prefix, "bin", "node"), "// stable node symlink target");
    try {
      const cellar = `${prefix}/Cellar/node/26.0.0/bin/node`;
      expect(resolveDurableNodePath(cellar)).toBe(`${prefix}/bin/node`);
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  it("falls back to the Cellar path when no stable symlink exists", () => {
    const cellar = "/tmp/bounty-hunter-no-symlink/Cellar/node/26.0.0/bin/node";
    expect(resolveDurableNodePath(cellar)).toBe(cellar);
  });
});

describe("extractProgramArguments", () => {
  it("parses node path and script path out of a generated plist", () => {
    const plist = generatePlist("/data/monitor.js", 300, "/opt/homebrew/bin/node");
    expect(extractProgramArguments(plist)).toEqual([
      "/opt/homebrew/bin/node",
      "/data/monitor.js",
    ]);
  });

  it("unescapes XML entities in extracted paths", () => {
    const plist = generatePlist("/path/with&<>chars.js", 300, "/opt/node");
    expect(extractProgramArguments(plist)).toEqual([
      "/opt/node",
      "/path/with&<>chars.js",
    ]);
  });

  it("returns [] when ProgramArguments is absent", () => {
    expect(extractProgramArguments("<plist><dict></dict></plist>")).toEqual([]);
  });
});

describe("doctor", () => {
  let originalHome: string | undefined;
  const HOME = "/tmp/bounty-hunter-doctor-test";

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = HOME;
    rmSync(HOME, { recursive: true, force: true });
    mkdirSync(HOME, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(HOME, { recursive: true, force: true });
  });

  it("reports the plist as missing when nothing is installed", () => {
    const report = doctor();
    expect(report.ok).toBe(false);
    const plistCheck = report.checks.find((c) => c.name === "plist");
    expect(plistCheck?.ok).toBe(false);
  });

  it("flags a node path that no longer exists (the brew-upgrade death)", () => {
    const plistDir = join(HOME, "Library", "LaunchAgents");
    mkdirSync(plistDir, { recursive: true });
    // Simulate an old install pinned to a now-deleted Cellar version.
    const plist = generatePlist(
      "/does/not/exist/monitor.js",
      300,
      "/opt/homebrew/Cellar/node/1.0.0/bin/node"
    );
    writeFileSync(join(plistDir, "com.bounty-hunter.monitor.plist"), plist);

    const report = doctor();
    expect(report.ok).toBe(false);
    const nodeCheck = report.checks.find((c) => c.name === "node-path");
    expect(nodeCheck?.ok).toBe(false);
    expect(nodeCheck?.detail).toMatch(/brew upgrade node/);
  });

  it("passes the node-path check when the plist points at a live binary", () => {
    const plistDir = join(HOME, "Library", "LaunchAgents");
    mkdirSync(plistDir, { recursive: true });
    const plist = generatePlist("/does/not/exist/monitor.js", 300, process.execPath);
    writeFileSync(join(plistDir, "com.bounty-hunter.monitor.plist"), plist);

    const report = doctor();
    const nodeCheck = report.checks.find((c) => c.name === "node-path");
    expect(nodeCheck?.ok).toBe(true);
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
