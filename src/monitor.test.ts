import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyPreFilter,
  applyFreshnessFilter,
  resolveRepoFilters,
  shouldNotify,
} from "./monitor.js";
import type { BountyIssue, Filters, VetResult } from "./types.js";

const makeIssue = (overrides: Partial<BountyIssue> = {}): BountyIssue => ({
  source: "github",
  repo: "Expensify/App",
  number: 100,
  title: "Fix button",
  url: "https://github.com/Expensify/App/issues/100",
  labels: ["Help Wanted"],
  assignees: [],
  body: "Description",
  comment_count: 0,
  created_at: "2026-02-05T00:00:00Z",
  ...overrides,
});

const defaultFilters: Filters = {
  max_age_days: 7,
  claimed_labels: ["Reviewing", "Approved", "Assigned", "Under Review", "In Progress"],
  max_comment_count: 5,
  skip_assigned: true,
};

describe("applyPreFilter", () => {
  it("passes issues with no exclude keywords", () => {
    const result = applyPreFilter(makeIssue(), undefined);
    expect(result).toBe(true);
  });

  it("excludes issues matching keyword in title", () => {
    const result = applyPreFilter(
      makeIssue({ title: "Fix Android native crash" }),
      { keywords_exclude: ["Android"] }
    );
    expect(result).toBe(false);
  });

  it("excludes issues matching keyword in body", () => {
    const result = applyPreFilter(
      makeIssue({ body: "This only affects iOS native" }),
      { keywords_exclude: ["iOS native"] }
    );
    expect(result).toBe(false);
  });

  it("is case-insensitive", () => {
    const result = applyPreFilter(
      makeIssue({ title: "Fix android bug" }),
      { keywords_exclude: ["Android"] }
    );
    expect(result).toBe(false);
  });
});

describe("applyFreshnessFilter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("age filtering", () => {
    it("passes issues within max_age_days", () => {
      // Fix "now" so the test is deterministic
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-10T00:00:00Z").getTime());
      const issue = makeIssue({ created_at: "2026-02-05T00:00:00Z" }); // 5 days old
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(true);
    });

    it("rejects issues older than max_age_days", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-20T00:00:00Z").getTime());
      const issue = makeIssue({ created_at: "2026-02-05T00:00:00Z" }); // 15 days old
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(false);
    });

    it("disables age check when max_age_days is 0", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-01T00:00:00Z").getTime());
      const issue = makeIssue({ created_at: "2025-01-01T00:00:00Z" }); // very old
      expect(applyFreshnessFilter(issue, { ...defaultFilters, max_age_days: 0 })).toBe(true);
    });

  });

  describe("assignee filtering", () => {
    it("rejects GitHub issues with assignees when skip_assigned is true", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ assignees: ["someone"] });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(false);
    });

    it("passes GitHub issues with assignees when skip_assigned is false", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ assignees: ["someone"] });
      expect(applyFreshnessFilter(issue, { ...defaultFilters, skip_assigned: false })).toBe(true);
    });

  });

  describe("claimed label filtering", () => {
    it("rejects issues with claimed labels", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ labels: ["Help Wanted", "Reviewing"] });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(false);
    });

    it("is case-insensitive for label matching", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ labels: ["Help Wanted", "in progress"] });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(false);
    });

    it("passes issues with no claimed labels", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ labels: ["Help Wanted", "Bug"] });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(true);
    });
  });

  describe("comment count filtering", () => {
    it("rejects issues at the comment threshold", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ comment_count: 5 });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(false);
    });

    it("passes issues below the comment threshold", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ comment_count: 4 });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(true);
    });

    it("disables comment check when max_comment_count is 0", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ comment_count: 100 });
      expect(applyFreshnessFilter(issue, { ...defaultFilters, max_comment_count: 0 })).toBe(true);
    });
  });

  describe("github_search filtering", () => {
    it("rejects github_search issues with assignees when skip_assigned is true", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ source: "github_search", assignees: ["someone"] });
      expect(applyFreshnessFilter(issue, { ...defaultFilters, skip_assigned: true })).toBe(false);
    });

    it("rejects github_search issues with claimed labels", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ source: "github_search", labels: ["Reviewing"] });
      expect(applyFreshnessFilter(issue, { ...defaultFilters, claimed_labels: ["Reviewing"] })).toBe(false);
    });

    it("rejects github_search issues exceeding comment count", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ source: "github_search", comment_count: 10 });
      expect(applyFreshnessFilter(issue, { ...defaultFilters, max_comment_count: 5 })).toBe(false);
    });

    it("passes github_search issues that meet all criteria", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ source: "github_search", assignees: [], labels: ["bounty"], comment_count: 1 });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(true);
    });
  });

  describe("boss filtering", () => {
    it("applies assignee/label/comment checks to enriched boss issues", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      // Enriched Boss issues have real metadata — filters should apply
      expect(applyFreshnessFilter(
        makeIssue({ source: "boss", assignees: ["someone"] }),
        { ...defaultFilters, skip_assigned: true }
      )).toBe(false);
      expect(applyFreshnessFilter(
        makeIssue({ source: "boss", labels: ["Reviewing"] }),
        defaultFilters
      )).toBe(false);
      expect(applyFreshnessFilter(
        makeIssue({ source: "boss", comment_count: 10 }),
        { ...defaultFilters, max_comment_count: 5 }
      )).toBe(false);
    });

    it("passes boss issues that meet all criteria", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
      const issue = makeIssue({ source: "boss", assignees: [], labels: [], comment_count: 1 });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(true);
    });

    it("still applies age check to boss issues", () => {
      vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-20T00:00:00Z").getTime());
      const issue = makeIssue({ source: "boss", created_at: "2026-02-01T00:00:00Z" });
      expect(applyFreshnessFilter(issue, defaultFilters)).toBe(false);
    });
  });
});

describe("shouldNotify", () => {
  const makeVetResult = (passed: boolean): VetResult => ({
    passed,
    signals: [],
    proposal_count: 0,
    has_approved_proposal: false,
    summary: passed ? "Vetted: OK" : "Failed: access_requirements",
  });

  it("always notifies when no vet result is provided", () => {
    expect(shouldNotify(undefined, "skip")).toBe(true);
    expect(shouldNotify(undefined, "warn")).toBe(true);
    expect(shouldNotify(undefined, "notify_all")).toBe(true);
  });

  it("always notifies when vetting passed", () => {
    const passed = makeVetResult(true);
    expect(shouldNotify(passed, "skip")).toBe(true);
    expect(shouldNotify(passed, "warn")).toBe(true);
    expect(shouldNotify(passed, "notify_all")).toBe(true);
  });

  it("skips notification on failed vetting with on_fail=skip", () => {
    const failed = makeVetResult(false);
    expect(shouldNotify(failed, "skip")).toBe(false);
  });

  it("notifies with warning on failed vetting with on_fail=warn", () => {
    const failed = makeVetResult(false);
    expect(shouldNotify(failed, "warn")).toBe(true);
  });

  it("notifies on failed vetting with on_fail=notify_all", () => {
    const failed = makeVetResult(false);
    expect(shouldNotify(failed, "notify_all")).toBe(true);
  });
});

describe("resolveRepoFilters", () => {
  it("returns global filters when no override is given", () => {
    expect(resolveRepoFilters(defaultFilters, undefined)).toEqual(defaultFilters);
  });

  it("applies only the overridden keys", () => {
    const resolved = resolveRepoFilters(defaultFilters, {
      skip_assigned: false,
      max_comment_count: 0,
    });
    expect(resolved.skip_assigned).toBe(false);
    expect(resolved.max_comment_count).toBe(0);
    expect(resolved.max_age_days).toBe(defaultFilters.max_age_days);
    expect(resolved.claimed_labels).toEqual(defaultFilters.claimed_labels);
  });

  it("does not mutate the global filters object", () => {
    const global = { ...defaultFilters };
    resolveRepoFilters(global, { skip_assigned: false });
    expect(global.skip_assigned).toBe(true);
  });

  it("lets an Expensify-style issue pass with assignee and comment overrides", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
    // The shape that previously dropped 100% of Expensify bounties:
    // auto-assigned internal engineer plus an instant bot comment storm
    const issue = makeIssue({ assignees: ["internal-engineer"], comment_count: 26 });
    expect(applyFreshnessFilter(issue, defaultFilters)).toBe(false);
    const resolved = resolveRepoFilters(defaultFilters, {
      skip_assigned: false,
      max_comment_count: 0,
    });
    expect(applyFreshnessFilter(issue, resolved)).toBe(true);
  });

  it("still applies claimed-label drops under overrides", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-06T00:00:00Z").getTime());
    const issue = makeIssue({ labels: ["Help Wanted", "Reviewing"] });
    const resolved = resolveRepoFilters(defaultFilters, { skip_assigned: false });
    expect(applyFreshnessFilter(issue, resolved)).toBe(false);
  });
});
