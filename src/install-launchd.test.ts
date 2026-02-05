import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generatePlist } from "./install-launchd.js";
import { mkdirSync, rmSync } from "node:fs";

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
});
