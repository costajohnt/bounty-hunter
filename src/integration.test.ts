import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/bounty-hunter-integration";

// A fake `gh` executable placed first on PATH for the spawned CLI. The CLI
// runs as a child process, so vi.mock can't reach its gh calls; intercepting
// the binary keeps this a real end-to-end test (argv parsing, config load,
// filter pipeline, JSON output) while staying deterministic and offline.
function writeGhShim(searchFixture: unknown, commentsFixture: unknown): void {
  const binDir = join(TEST_DIR, "bin");
  mkdirSync(binDir, { recursive: true });
  const shim = `#!/bin/sh
case "$1" in
  search)
    cat <<'JSON'
${JSON.stringify(searchFixture)}
JSON
    ;;
  issue)
    cat <<'JSON'
${JSON.stringify(commentsFixture)}
JSON
    ;;
  auth)
    exit 0
    ;;
  *)
    echo "gh shim: unexpected command: $@" >&2
    exit 1
    ;;
esac
`;
  const shimPath = join(binDir, "gh");
  writeFileSync(shimPath, shim);
  chmodSync(shimPath, 0o755);
}

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
  boss:
    enabled: false
`;
    writeFileSync(join(dataDir, "watchlist.yml"), config);

    // Seed a seen entry older than the 90-day retention default. The prune
    // fires during scan and must log to stderr, keeping --json stdout parseable.
    writeFileSync(
      join(dataDir, "seen.json"),
      JSON.stringify([
        {
          id: "Expensify/App#1",
          repo: "Expensify/App",
          number: 1,
          title: "Ancient seen entry",
          seen_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
          skipped: false,
        },
      ])
    );

    // One day old: inside the 7-day freshness window on every run
    const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    writeGhShim(
      [
        {
          number: 81500,
          title: "[$250] Modal does not close on escape key",
          url: "https://github.com/Expensify/App/issues/81500",
          createdAt,
          labels: [{ name: "Help Wanted" }, { name: "Bug" }],
          body: "Reproduction: open any modal and press escape.",
          commentsCount: 2,
          assignees: [],
        },
      ],
      {
        comments: [
          {
            author: { login: "alice" },
            authorAssociation: "NONE",
            body: "I can reproduce this on staging-free local setup.",
            createdAt,
            url: "https://github.com/Expensify/App/issues/81500#issuecomment-1",
          },
        ],
      }
    );
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("scan command returns JSON output", () => {
    const result = execFileSync("node", ["dist/index.js", "scan", "--json"], {
      encoding: "utf-8",
      cwd: join(import.meta.dirname ?? ".", ".."),
      env: {
        ...process.env,
        HOME: TEST_DIR,
        PATH: `${join(TEST_DIR, "bin")}:${process.env.PATH ?? ""}`,
      },
    });
    const issues = JSON.parse(result);
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(1);

    const issue = issues[0];
    expect(issue.repo).toBe("Expensify/App");
    expect(issue.number).toBe(81500);
    expect(issue.title).toBe("[$250] Modal does not close on escape key");
    expect(issue.url).toBe("https://github.com/Expensify/App/issues/81500");
    expect(issue.source).toBe("github");
    expect(issue.bounty_amount).toBe(250);
    expect(issue.is_new).toBe(true);
    // Vetting ran against the shimmed comments and passed
    expect(issue.vetResult?.passed).toBe(true);
  });

  it("scan command respects the freshness filter", () => {
    // Regenerate the shim with a stale issue (30 days old, window is 7)
    const staleCreatedAt = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    writeGhShim(
      [
        {
          number: 81501,
          title: "[$250] Old issue outside the freshness window",
          url: "https://github.com/Expensify/App/issues/81501",
          createdAt: staleCreatedAt,
          labels: [{ name: "Help Wanted" }],
          body: "Stale.",
          commentsCount: 0,
          assignees: [],
        },
      ],
      { comments: [] }
    );

    const result = execFileSync("node", ["dist/index.js", "scan", "--json"], {
      encoding: "utf-8",
      cwd: join(import.meta.dirname ?? ".", ".."),
      env: {
        ...process.env,
        HOME: TEST_DIR,
        PATH: `${join(TEST_DIR, "bin")}:${process.env.PATH ?? ""}`,
      },
    });
    const issues = JSON.parse(result);
    expect(issues).toHaveLength(0);
  });
});
