import { describe, it, expect } from "vitest";
import { buildGlobalSearchArgs, parseGlobalSearchResults } from "./github-search.js";
import type { GitHubSearchSource } from "./types.js";

const defaultConfig: GitHubSearchSource = {
  enabled: true,
  labels: ["bounty"],
  languages: [],
  min_stars: 0,
  keywords_exclude: [],
  repos_exclude: [],
  require_bounty_amount: false,
  max_results: 50,
};

function mockSearchResult(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify([{
    number: 42,
    title: "Fix the bug $100",
    url: "https://github.com/org/repo/issues/42",
    createdAt: "2026-02-15T00:00:00Z",
    labels: [{ name: "bounty" }],
    assignees: [],
    body: "Bug description",
    commentsCount: 2,
    repository: { nameWithOwner: "org/repo", stargazerCount: 500 },
    ...overrides,
  }]);
}

describe("buildGlobalSearchArgs", () => {
  it("builds correct base flags", () => {
    const args = buildGlobalSearchArgs(defaultConfig, "bounty");
    expect(args).toContain("search");
    expect(args).toContain("issues");
    expect(args).toContain("--state");
    expect(args).toContain("open");
    expect(args).toContain("--limit");
  });

  it("includes the given label as --label flag", () => {
    const args = buildGlobalSearchArgs(defaultConfig, "bounty");
    const labelIdx = args.indexOf("--label");
    expect(labelIdx).toBeGreaterThan(-1);
    expect(args[labelIdx + 1]).toBe("bounty");
  });

  it("adds --language when languages configured", () => {
    const config = { ...defaultConfig, languages: ["typescript"] };
    const args = buildGlobalSearchArgs(config, "bounty");
    expect(args).toContain("--language");
    expect(args).toContain("typescript");
  });

  it("only uses first language when multiple configured", () => {
    const config = { ...defaultConfig, languages: ["typescript", "python", "go"] };
    const args = buildGlobalSearchArgs(config, "bounty");
    const languageFlags = args.reduce((count, arg) => arg === "--language" ? count + 1 : count, 0);
    expect(languageFlags).toBe(1);
    expect(args).toContain("typescript");
    expect(args).not.toContain("python");
    expect(args).not.toContain("go");
  });

  it("does not add --language when languages empty", () => {
    const args = buildGlobalSearchArgs(defaultConfig, "bounty");
    expect(args).not.toContain("--language");
  });

  it("uses max_results for --limit value", () => {
    const config = { ...defaultConfig, max_results: 25 };
    const args = buildGlobalSearchArgs(config, "bounty");
    const limitIdx = args.indexOf("--limit");
    expect(args[limitIdx + 1]).toBe("25");
  });

  it("includes repository in --json fields", () => {
    const args = buildGlobalSearchArgs(defaultConfig, "bounty");
    const jsonIdx = args.indexOf("--json");
    expect(args[jsonIdx + 1]).toContain("repository");
  });
});

describe("parseGlobalSearchResults", () => {
  it("maps results to BountyIssue with github_search source", () => {
    const issues = parseGlobalSearchResults(mockSearchResult(), defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].source).toBe("github_search");
    expect(issues[0].repo).toBe("org/repo");
    expect(issues[0].number).toBe(42);
    expect(issues[0].title).toBe("Fix the bug $100");
    expect(issues[0].url).toBe("https://github.com/org/repo/issues/42");
    expect(issues[0].labels).toEqual(["bounty"]);
    expect(issues[0].body).toBe("Bug description");
    expect(issues[0].comment_count).toBe(2);
    expect(issues[0].created_at).toBe("2026-02-15T00:00:00Z");
  });

  it("returns empty array for empty results", () => {
    const issues = parseGlobalSearchResults("[]", defaultConfig);
    expect(issues).toEqual([]);
  });

  it("filters by min_stars", () => {
    const config = { ...defaultConfig, min_stars: 50 };
    const raw = mockSearchResult({ repository: { nameWithOwner: "small/repo", stargazerCount: 10 } });
    const issues = parseGlobalSearchResults(raw, config);
    expect(issues).toHaveLength(0);
  });

  it("filters by repos_exclude blocklist", () => {
    const config = { ...defaultConfig, repos_exclude: ["waxeye7/screeps-bounty-arena"] };
    const raw = mockSearchResult({
      repository: { nameWithOwner: "waxeye7/screeps-bounty-arena", stargazerCount: 999 },
    });
    expect(parseGlobalSearchResults(raw, config)).toHaveLength(0);
    // Non-blocked repos still pass
    expect(parseGlobalSearchResults(mockSearchResult(), config)).toHaveLength(1);
  });

  it("drops issues without a detected dollar amount when require_bounty_amount is set", () => {
    const config = { ...defaultConfig, require_bounty_amount: true };
    const noAmount = mockSearchResult({ title: "bug-hunt: find the regression", body: "no payout mentioned" });
    expect(parseGlobalSearchResults(noAmount, config)).toHaveLength(0);
    // Amount in title passes
    expect(parseGlobalSearchResults(mockSearchResult(), config)).toHaveLength(1);
    // Amount only in body passes too
    const bodyAmount = mockSearchResult({ title: "Fix the bug", body: "Bounty: $250 on completion" });
    expect(parseGlobalSearchResults(bodyAmount, config)).toHaveLength(1);
  });

  it("keeps issues without amounts when require_bounty_amount is off", () => {
    const noAmount = mockSearchResult({ title: "bug-hunt: find the regression", body: "no payout" });
    expect(parseGlobalSearchResults(noAmount, defaultConfig)).toHaveLength(1);
  });

  it("filters by keywords_exclude in title", () => {
    const config = { ...defaultConfig, keywords_exclude: ["internal"] };
    const raw = mockSearchResult({ title: "Internal tool fix $100" });
    const issues = parseGlobalSearchResults(raw, config);
    expect(issues).toHaveLength(0);
  });

  it("filters by keywords_exclude in body", () => {
    const config = { ...defaultConfig, keywords_exclude: ["confidential"] };
    const raw = mockSearchResult({ title: "Fix bug $100", body: "This is a confidential project" });
    const issues = parseGlobalSearchResults(raw, config);
    expect(issues).toHaveLength(0);
  });

  it("filters by keywords_exclude case-insensitively", () => {
    const config = { ...defaultConfig, keywords_exclude: ["INTERNAL"] };
    const raw = mockSearchResult({ title: "Fix internal bug $100" });
    const issues = parseGlobalSearchResults(raw, config);
    expect(issues).toHaveLength(0);
  });

  it("deduplicates against watched repos", () => {
    const raw = mockSearchResult({ repository: { nameWithOwner: "Expensify/App", stargazerCount: 500 } });
    const issues = parseGlobalSearchResults(raw, defaultConfig, ["Expensify/App"]);
    expect(issues).toHaveLength(0);
  });

  it("extracts bounty amount from title", () => {
    const raw = mockSearchResult({ title: "$500 bounty for fix" });
    const issues = parseGlobalSearchResults(raw, defaultConfig);
    expect(issues[0].bounty_amount).toBe(500);
    expect(issues[0].bounty_formatted).toBe("$500");
  });

  it("extracts bounty amount from body when not in title", () => {
    const raw = mockSearchResult({ title: "Fix the bug", body: "Reward: $250" });
    const issues = parseGlobalSearchResults(raw, defaultConfig);
    expect(issues[0].bounty_amount).toBe(250);
  });

  it("bounty_formatted falls back to body extraction", () => {
    const raw = mockSearchResult({ title: "Fix the bug", body: "Reward: $250" });
    const issues = parseGlobalSearchResults(raw, defaultConfig);
    expect(issues[0].bounty_formatted).toBe("$250");
  });

  it("extracts comma-formatted bounty amounts", () => {
    const raw = mockSearchResult({ title: "$1,000 bounty" });
    const issues = parseGlobalSearchResults(raw, defaultConfig);
    expect(issues[0].bounty_amount).toBe(1000);
    expect(issues[0].bounty_formatted).toBe("$1,000");
  });

  it("keeps items that pass all filters", () => {
    const config = { ...defaultConfig, min_stars: 100, keywords_exclude: ["spam"] };
    const raw = mockSearchResult();
    const issues = parseGlobalSearchResults(raw, config, ["other/repo"]);
    expect(issues).toHaveLength(1);
  });
});
