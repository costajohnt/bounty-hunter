import { describe, it, expect } from "vitest";
import { buildAlgoraUrl, parseAlgoraResponse, buildAlgoraFilters } from "./algora.js";
import type { AlgoraSource } from "./types.js";

describe("buildAlgoraUrl", () => {
  it("builds URL with default params", () => {
    const url = buildAlgoraUrl({});
    expect(url).toContain("algora.io/api/trpc/bounty.list");
    expect(url).toContain("status");
    expect(url).toContain("open");
  });

  it("builds URL with limit", () => {
    const url = buildAlgoraUrl({ limit: 10 });
    expect(url).toContain("10");
  });
});

describe("parseAlgoraResponse", () => {
  it("parses a valid Algora response into BountyIssues", () => {
    const raw = [{
      result: {
        data: {
          json: {
            items: [{
              id: "abc123",
              status: "open",
              reward: { currency: "USD", amount: 25000 },
              reward_formatted: "$250",
              tech: ["typescript"],
              created_at: "2026-02-05T00:00:00Z",
              task: {
                number: 100,
                title: "Fix bug",
                url: "https://github.com/test/repo/issues/100",
                body: "Description here",
                repo_name: "repo",
                repo_owner: "test",
              },
              org: { handle: "test", name: "Test Org" },
            }],
            next_cursor: null,
          },
        },
      },
    }];
    const issues = parseAlgoraResponse(raw);
    expect(issues).toHaveLength(1);
    expect(issues[0].bounty_amount).toBe(250);
    expect(issues[0].repo).toBe("test/repo");
    expect(issues[0].source).toBe("algora");
    expect(issues[0].bounty_confidence).toBe("api");
    expect(issues[0].bounty_currency).toBe("USD");
  });

  it("filters by minimum bounty", () => {
    const raw = [{
      result: {
        data: {
          json: {
            items: [
              {
                id: "a", status: "open",
                reward: { currency: "USD", amount: 5000 },
                reward_formatted: "$50",
                tech: [], created_at: "2026-02-05T00:00:00Z",
                task: { number: 1, title: "Small", url: "https://github.com/t/r/issues/1", body: "", repo_name: "r", repo_owner: "t" },
                org: { handle: "t", name: "T" },
              },
              {
                id: "b", status: "open",
                reward: { currency: "USD", amount: 100000 },
                reward_formatted: "$1,000",
                tech: [], created_at: "2026-02-05T00:00:00Z",
                task: { number: 2, title: "Big", url: "https://github.com/t/r/issues/2", body: "", repo_name: "r", repo_owner: "t" },
                org: { handle: "t", name: "T" },
              },
            ],
            next_cursor: null,
          },
        },
      },
    }];
    const issues = parseAlgoraResponse(raw, { min_bounty: 100 });
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Big");
  });

  it("filters by keywords_exclude in title", () => {
    const raw = [{
      result: {
        data: {
          json: {
            items: [
              {
                id: "a", status: "open",
                reward: { currency: "USD", amount: 10000 },
                reward_formatted: "$100",
                tech: [], created_at: "2026-02-05T00:00:00Z",
                task: { number: 1, title: "Fix devops pipeline", url: "https://github.com/t/r/issues/1", body: "Some body", repo_name: "r", repo_owner: "t" },
                org: { handle: "t", name: "T" },
              },
              {
                id: "b", status: "open",
                reward: { currency: "USD", amount: 20000 },
                reward_formatted: "$200",
                tech: [], created_at: "2026-02-05T00:00:00Z",
                task: { number: 2, title: "Add new feature", url: "https://github.com/t/r/issues/2", body: "Feature description", repo_name: "r", repo_owner: "t" },
                org: { handle: "t", name: "T" },
              },
            ],
            next_cursor: null,
          },
        },
      },
    }];
    const issues = parseAlgoraResponse(raw, { keywords_exclude: ["devops"] });
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Add new feature");
  });

  it("filters by keywords_exclude in body", () => {
    const raw = [{
      result: {
        data: {
          json: {
            items: [
              {
                id: "a", status: "open",
                reward: { currency: "USD", amount: 10000 },
                reward_formatted: "$100",
                tech: [], created_at: "2026-02-05T00:00:00Z",
                task: { number: 1, title: "Fix issue", url: "https://github.com/t/r/issues/1", body: "This involves Kubernetes orchestration", repo_name: "r", repo_owner: "t" },
                org: { handle: "t", name: "T" },
              },
              {
                id: "b", status: "open",
                reward: { currency: "USD", amount: 20000 },
                reward_formatted: "$200",
                tech: [], created_at: "2026-02-05T00:00:00Z",
                task: { number: 2, title: "Another issue", url: "https://github.com/t/r/issues/2", body: "Simple frontend fix", repo_name: "r", repo_owner: "t" },
                org: { handle: "t", name: "T" },
              },
            ],
            next_cursor: null,
          },
        },
      },
    }];
    const issues = parseAlgoraResponse(raw, { keywords_exclude: ["kubernetes"] });
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Another issue");
  });
});

describe("buildAlgoraUrl with cursor", () => {
  it("includes cursor in URL when provided", () => {
    const url = buildAlgoraUrl({ cursor: "abc123" });
    expect(url).toContain("abc123");
  });

  it("does not include cursor when null", () => {
    const url = buildAlgoraUrl({ cursor: null });
    const decoded = decodeURIComponent(url);
    expect(decoded).not.toContain('"cursor"');
  });
});

describe("buildAlgoraFilters", () => {
  it("converts AlgoraSource to filter params correctly", () => {
    const source: AlgoraSource = {
      enabled: true,
      min_bounty: 100,
      languages: ["typescript", "rust"],
      keywords_exclude: ["devops", "infra"],
      max_pages: 3,
    };
    const filters = buildAlgoraFilters(source);
    expect(filters.min_bounty).toBe(100);
    expect(filters.languages).toEqual(["typescript", "rust"]);
    expect(filters.keywords_exclude).toEqual(["devops", "infra"]);
  });

  it("converts empty languages array to undefined", () => {
    const source: AlgoraSource = {
      enabled: true,
      min_bounty: 50,
      languages: [],
      keywords_exclude: [],
      max_pages: 3,
    };
    const filters = buildAlgoraFilters(source);
    expect(filters.min_bounty).toBe(50);
    expect(filters.languages).toBeUndefined();
    expect(filters.keywords_exclude).toEqual([]);
  });

  it("passes max_pages through to filter params", () => {
    const source: AlgoraSource = {
      enabled: true,
      min_bounty: 100,
      languages: [],
      keywords_exclude: [],
      max_pages: 5,
    };
    const filters = buildAlgoraFilters(source);
    expect(filters.max_pages).toBe(5);
  });
});
