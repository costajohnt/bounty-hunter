import { describe, it, expect, vi } from "vitest";
import { parseIssueUrl, buildSearchArgs, buildIssueViewArgs, buildIssueMetadataArgs, fetchRepoIssues } from "./github.js";

const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

describe("parseIssueUrl", () => {
  it("parses a standard GitHub issue URL", () => {
    const result = parseIssueUrl("https://github.com/Expensify/App/issues/81500");
    expect(result).toEqual({ owner: "Expensify", repo: "App", number: 81500 });
  });

  it("parses a URL with trailing slash", () => {
    const result = parseIssueUrl("https://github.com/Expensify/App/issues/81500/");
    expect(result).toEqual({ owner: "Expensify", repo: "App", number: 81500 });
  });

  it("throws on invalid URL", () => {
    expect(() => parseIssueUrl("https://google.com")).toThrow();
  });
});

describe("buildSearchArgs", () => {
  it("builds gh search args for a repo with labels", () => {
    const args = buildSearchArgs("Expensify/App", "Help Wanted");
    expect(args).toContain("search");
    expect(args).toContain("issues");
    expect(args).toContain("Expensify/App");
    expect(args).toContain("Help Wanted");
  });

  it("includes assignees in the JSON fields", () => {
    const args = buildSearchArgs("Expensify/App", "Help Wanted");
    const jsonIdx = args.indexOf("--json");
    const jsonFields = args[jsonIdx + 1];
    expect(jsonFields).toContain("assignees");
  });

  it("passes a single --label (GitHub search ANDs repeated label qualifiers)", () => {
    const args = buildSearchArgs("Expensify/App", "Help Wanted");
    const labelFlags = args.reduce((count, arg) => arg === "--label" ? count + 1 : count, 0);
    expect(labelFlags).toBe(1);
  });

  it("omits --label when no label is given", () => {
    expect(buildSearchArgs("Expensify/App")).not.toContain("--label");
  });
});

describe("fetchRepoIssues", () => {
  const issue = (number: number, createdAt: string, label: string) => ({
    number,
    title: `Issue ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    createdAt,
    labels: [{ name: label }],
    assignees: [],
    body: "",
    commentsCount: 0,
  });

  it("ORs repo labels: one search per label, deduped by issue number", () => {
    mockExecFileSync.mockReset();
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      const label = args[args.indexOf("--label") + 1];
      if (label === "bounty") {
        return JSON.stringify([issue(1, "2026-01-01T00:00:00Z", "bounty"), issue(3, "2026-01-03T00:00:00Z", "bounty")]);
      }
      if (label === "💰 bounty") {
        return JSON.stringify([issue(2, "2026-01-02T00:00:00Z", "💰 bounty"), issue(3, "2026-01-03T00:00:00Z", "💰 bounty")]);
      }
      return "[]";
    });

    const issues = fetchRepoIssues("o/r", ["bounty", "💰 bounty"]);

    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    for (const call of mockExecFileSync.mock.calls) {
      expect(call[0]).toBe("gh");
      expect(Array.isArray(call[1])).toBe(true);
      expect((call[1] as string[]).filter((a) => a === "--label")).toHaveLength(1);
    }
    expect(issues.map((i) => i.number)).toEqual([3, 2, 1]);
  });

  it("runs one unlabeled search when no labels are configured", () => {
    mockExecFileSync.mockReset();
    mockExecFileSync.mockReturnValue(JSON.stringify([issue(5, "2026-01-05T00:00:00Z", "bug")]));

    const issues = fetchRepoIssues("o/r", []);

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync.mock.calls[0][1]).not.toContain("--label");
    expect(issues.map((i) => i.number)).toEqual([5]);
  });
});

describe("buildIssueViewArgs", () => {
  it("builds gh issue view args for fetching comments", () => {
    const args = buildIssueViewArgs("Expensify/App", 81500);
    expect(args).toContain("issue");
    expect(args).toContain("view");
    expect(args).toContain("81500");
    expect(args).toContain("Expensify/App");
    expect(args).toContain("comments");
  });

  it("uses --repo flag for the repo", () => {
    const args = buildIssueViewArgs("Expensify/App", 100);
    const repoIdx = args.indexOf("--repo");
    expect(repoIdx).toBeGreaterThan(-1);
    expect(args[repoIdx + 1]).toBe("Expensify/App");
  });

  it("passes issue number as string", () => {
    const args = buildIssueViewArgs("foo/bar", 42);
    expect(args).toContain("42");
  });
});

describe("buildIssueMetadataArgs", () => {
  it("builds gh issue view args for fetching metadata", () => {
    const args = buildIssueMetadataArgs("Expensify/App", 81500);
    expect(args).toContain("issue");
    expect(args).toContain("view");
    expect(args).toContain("81500");
    expect(args).toContain("Expensify/App");
  });

  it("requests the correct JSON fields", () => {
    const args = buildIssueMetadataArgs("Expensify/App", 81500);
    const jsonIdx = args.indexOf("--json");
    expect(jsonIdx).toBeGreaterThan(-1);
    const jsonFields = args[jsonIdx + 1];
    expect(jsonFields).toContain("body");
    expect(jsonFields).toContain("labels");
    expect(jsonFields).toContain("assignees");
    expect(jsonFields).toContain("createdAt");
    expect(jsonFields).toContain("comments");
    expect(jsonFields).not.toContain("commentsCount");
  });

  it("uses --repo flag for the repo", () => {
    const args = buildIssueMetadataArgs("foo/bar", 42);
    const repoIdx = args.indexOf("--repo");
    expect(repoIdx).toBeGreaterThan(-1);
    expect(args[repoIdx + 1]).toBe("foo/bar");
  });

  it("passes issue number as string", () => {
    const args = buildIssueMetadataArgs("foo/bar", 42);
    expect(args).toContain("42");
  });
});

describe("fetchIssueMetadata", () => {
  it("parses GitHub API response into IssueMetadata", async () => {
    // gh issue view --json has no commentsCount field; comments is an array
    const mockResponse = JSON.stringify({
      body: "Fix the login bug",
      labels: [{ name: "bug" }, { name: "Help Wanted" }],
      assignees: [{ login: "alice" }, { login: "bob" }],
      createdAt: "2025-01-15T10:00:00Z",
      comments: [
        { author: { login: "carol" }, body: "first" },
        { author: { login: "dave" }, body: "second" },
        { author: { login: "carol" }, body: "third" },
        { author: { login: "erin" }, body: "fourth" },
        { author: { login: "frank" }, body: "fifth" },
      ],
    });

    mockExecFileSync.mockReturnValue(mockResponse);

    const { fetchIssueMetadata } = await import("./github.js");
    const result = fetchIssueMetadata("Expensify/App", 81500);

    expect(result).toEqual({
      body: "Fix the login bug",
      labels: ["bug", "Help Wanted"],
      assignees: ["alice", "bob"],
      comment_count: 5,
      created_at: "2025-01-15T10:00:00Z",
    });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      buildIssueMetadataArgs("Expensify/App", 81500),
      expect.objectContaining({ encoding: "utf-8", timeout: 15000 }),
    );

    mockExecFileSync.mockReset();
  });

  it("handles empty labels and assignees", async () => {
    const mockResponse = JSON.stringify({
      body: "",
      labels: [],
      assignees: [],
      createdAt: "2025-06-01T00:00:00Z",
      comments: [],
    });

    mockExecFileSync.mockReturnValue(mockResponse);

    const { fetchIssueMetadata } = await import("./github.js");
    const result = fetchIssueMetadata("foo/bar", 1);

    expect(result).toEqual({
      body: "",
      labels: [],
      assignees: [],
      comment_count: 0,
      created_at: "2025-06-01T00:00:00Z",
    });

    mockExecFileSync.mockReset();
  });

  it("throws when gh CLI fails", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh: command not found");
    });

    const { fetchIssueMetadata } = await import("./github.js");
    expect(() => fetchIssueMetadata("foo/bar", 1)).toThrow("gh: command not found");

    mockExecFileSync.mockReset();
  });

  it("throws on malformed JSON from gh", async () => {
    mockExecFileSync.mockReturnValue("not valid json");

    const { fetchIssueMetadata } = await import("./github.js");
    expect(() => fetchIssueMetadata("foo/bar", 1)).toThrow();

    mockExecFileSync.mockReset();
  });
});
