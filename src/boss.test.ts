import { describe, it, expect } from "vitest";
import { parseHId, parseBossResponse, buildBossFilters } from "./boss.js";
import type { BossSource } from "./types.js";

function makeBossItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    hId: "org/repo#42",
    title: "Fix the bug",
    url: "https://github.com/org/repo/issues/42",
    usd: 500,
    status: "open",
    sByC: { USD: 500 },
    ...overrides,
  };
}

describe("parseHId", () => {
  it("parses standard hId format", () => {
    const result = parseHId("kistek/boss-demo#3");
    expect(result).toEqual({ repo: "kistek/boss-demo", number: 3 });
  });

  it("parses hId with hyphenated names", () => {
    const result = parseHId("jbilcke-hf/clapper#5");
    expect(result).toEqual({ repo: "jbilcke-hf/clapper", number: 5 });
  });

  it("returns null for invalid hId (no #)", () => {
    expect(parseHId("invalid-format")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseHId("")).toBeNull();
  });

  it("handles large issue numbers", () => {
    const result = parseHId("sveltejs/svelte#1639");
    expect(result).toEqual({ repo: "sveltejs/svelte", number: 1639 });
  });
});

describe("parseBossResponse", () => {
  it("maps Boss items to BountyIssue array", () => {
    const items = [makeBossItem()];
    const issues = parseBossResponse(items);
    expect(issues).toHaveLength(1);
    expect(issues[0].source).toBe("boss");
    expect(issues[0].repo).toBe("org/repo");
    expect(issues[0].number).toBe(42);
    expect(issues[0].bounty_amount).toBe(500);
    expect(issues[0].url).toBe("https://github.com/org/repo/issues/42");
  });

  it("filters by minimum bounty", () => {
    const items = [
      makeBossItem({ usd: 50, hId: "a/b#1", url: "https://github.com/a/b/issues/1" }),
      makeBossItem({ usd: 500, hId: "c/d#2", url: "https://github.com/c/d/issues/2" }),
    ];
    const issues = parseBossResponse(items, { min_bounty: 100 });
    expect(issues).toHaveLength(1);
    expect(issues[0].bounty_amount).toBe(500);
  });

  it("filters out non-open items", () => {
    const items = [
      makeBossItem({ status: "solved" }),
    ];
    const issues = parseBossResponse(items);
    expect(issues).toHaveLength(0);
  });

  it("skips items with invalid hId", () => {
    const items = [
      makeBossItem({ hId: "invalid" }),
    ];
    const issues = parseBossResponse(items);
    expect(issues).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(parseBossResponse([])).toEqual([]);
  });

  it("formats bounty_formatted with dollar sign", () => {
    const items = [makeBossItem({ usd: 1000 })];
    const issues = parseBossResponse(items);
    expect(issues[0].bounty_formatted).toContain("$");
    expect(issues[0].bounty_formatted).toContain("1,000");
  });

  it("sets body to empty string (not provided by API)", () => {
    const items = [makeBossItem()];
    const issues = parseBossResponse(items);
    expect(issues[0].body).toBe("");
  });

  it("sets labels and assignees to empty arrays", () => {
    const items = [makeBossItem()];
    const issues = parseBossResponse(items);
    expect(issues[0].labels).toEqual([]);
    expect(issues[0].assignees).toEqual([]);
  });
});

describe("buildBossFilters", () => {
  it("converts BossSource to filter params", () => {
    const source: BossSource = { enabled: true, min_bounty: 100 };
    const filters = buildBossFilters(source);
    expect(filters.min_bounty).toBe(100);
  });

  it("returns undefined min_bounty when set to 0", () => {
    const source: BossSource = { enabled: true, min_bounty: 0 };
    const filters = buildBossFilters(source);
    expect(filters.min_bounty).toBeUndefined();
  });
});
