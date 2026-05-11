import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = join(tmpdir(), "bounty-hunter-integration");
const REAL_ARGV = [...process.argv];
const REAL_HOME = process.env.HOME;

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

describe("CLI integration", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecFileSync.mockReset();

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
filters:
  max_age_days: 0
  claimed_labels: []
  max_comment_count: 0
  skip_assigned: false
vetting:
  enabled: false
`;
    writeFileSync(join(dataDir, "watchlist.yml"), config);
  });

  afterEach(() => {
    process.argv = [...REAL_ARGV];
    if (REAL_HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = REAL_HOME;
    }
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("scan command returns JSON output from mocked GitHub search", async () => {
    const fixture = JSON.stringify([
      {
        number: 81500,
        title: "Help Wanted: deterministic integration fixture",
        url: "https://github.com/Expensify/App/issues/81500",
        createdAt: "2026-01-01T00:00:00Z",
        labels: [{ name: "Help Wanted" }],
        assignees: [],
        body: "Test issue body with /bounty $50.",
        commentsCount: 0,
      },
    ]);

    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === "gh" && args[0] === "search" && args[1] === "issues") {
        return fixture;
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    process.env.HOME = TEST_DIR;
    process.argv = ["node", "dist/index.js", "scan", "--json"];

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      output.push(String(message ?? ""));
    });

    await import("./index.js");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["search", "issues", "--repo", "Expensify/App"]),
      expect.objectContaining({ encoding: "utf-8", timeout: 30000 })
    );
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);

    const issues = JSON.parse(output.join("\n"));
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toHaveProperty("repo");
    expect(issues[0]).toHaveProperty("title");
    expect(issues[0]).toHaveProperty("url");
    expect(issues[0]).toMatchObject({
      repo: "Expensify/App",
      number: 81500,
      bounty_amount: 50,
      is_new: true,
    });
  });
});
