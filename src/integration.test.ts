import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/bounty-hunter-integration";
const REAL_HOME = process.env.HOME ?? "";

describe("CLI integration", () => {
  beforeEach(() => {
    const dataDir = join(TEST_DIR, ".bounty-hunter");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, "proposals"), { recursive: true });
    mkdirSync(join(dataDir, "clones"), { recursive: true });

    const config = `
polling_interval: 5
telegram:
  bot_token: "fake-token"
  chat_id: "12345"
sources:
  repos:
    - name: Expensify/App
      labels: ["Help Wanted"]
      proposal_template: expensify
  algora:
    enabled: false
    min_bounty: 50
    languages: []
    keywords_exclude: []
`;
    writeFileSync(join(dataDir, "watchlist.yml"), config);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("scan command returns JSON output", () => {
    // Skip in CI if gh is not available
    try {
      execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    } catch {
      return;
    }

    const result = execFileSync(
      "node",
      ["dist/index.js", "scan", "--json"],
      {
        encoding: "utf-8",
        cwd: join(import.meta.dirname ?? ".", ".."),
        env: {
          ...process.env,
          HOME: TEST_DIR,
          GH_CONFIG_DIR: join(REAL_HOME, ".config", "gh"),
        },
      }
    );
    const issues = JSON.parse(result);
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toHaveProperty("repo");
    expect(issues[0]).toHaveProperty("title");
    expect(issues[0]).toHaveProperty("url");
  });
});
