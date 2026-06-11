import { describe, it, expect } from "vitest";
import { formatBountyNotification } from "./telegram.js";
import type { BountyIssue, VetResult } from "./types.js";

const makeIssue = (overrides: Partial<BountyIssue> = {}): BountyIssue => ({
  source: "github",
  repo: "Expensify/App",
  number: 81500,
  title: "Fix modal doesn't close on escape key",
  url: "https://github.com/Expensify/App/issues/81500",
  bounty_amount: 250,
  bounty_formatted: "$250",
  labels: ["Help Wanted", "Bug"],
  assignees: [],
  body: "Some description",
  comment_count: 0,
  created_at: "2026-02-05T12:00:00Z",
  ...overrides,
});

describe("formatBountyNotification", () => {
  it("formats a GitHub bounty issue (no vet result)", () => {
    const msg = formatBountyNotification(makeIssue());
    expect(msg).toContain("Expensify/App");
    expect(msg).toContain("#81500");
    expect(msg).toContain("$250");
    expect(msg).toContain("Proposals: 0");
    expect(msg).toContain("https://github.com/Expensify/App/issues/81500");
    // Default emoji when no vet result
    expect(msg).toContain("\ud83c\udfaf");
  });

  it("shows checkmark and OK for passed vetting", () => {
    const vetResult: VetResult = {
      passed: true,
      signals: [],
      proposal_count: 1,
      has_approved_proposal: false,
      summary: "Vetted: OK",
    };
    const msg = formatBountyNotification(makeIssue(), vetResult);
    expect(msg).toContain("\u2705"); // ✅
    expect(msg).toContain("Vetted: OK");
    expect(msg).toContain("Proposals: 1");
  });

  it("shows warning and summary for failed vetting", () => {
    const vetResult: VetResult = {
      passed: false,
      signals: [],
      proposal_count: 4,
      has_approved_proposal: false,
      summary: "Failed: access_requirements, competition",
    };
    const msg = formatBountyNotification(makeIssue(), vetResult);
    expect(msg).toContain("\u26a0\ufe0f"); // ⚠️
    expect(msg).toContain("Failed: access_requirements, competition");
    expect(msg).not.toContain("Vetted: Failed:"); // no redundant prefix
    expect(msg).toContain("Proposals: 4");
  });

  it("uses verified proposal_count instead of raw comment_count", () => {
    const issue = makeIssue({ comment_count: 15 });
    const vetResult: VetResult = {
      passed: true,
      signals: [],
      proposal_count: 2,
      has_approved_proposal: false,
      summary: "Vetted: OK",
    };
    const msg = formatBountyNotification(issue, vetResult);
    expect(msg).toContain("Proposals: 2");
    expect(msg).not.toContain("Proposals: 15");
  });

  it("shows (Boss) for boss issues", () => {
    const issue = makeIssue({
      source: "boss",
      repo: "org/repo",
      number: 3,
      title: "Add feature",
      url: "https://github.com/org/repo/issues/3",
      bounty_amount: 200,
      bounty_formatted: "$200",
      labels: [],
      body: "",
      comment_count: 0,
    });
    const result = formatBountyNotification(issue);
    expect(result).toContain("(Boss)");
  });

  it("shows (Global) for github_search issues", () => {
    const issue = makeIssue({
      source: "github_search",
      repo: "some-org/some-repo",
      number: 42,
      title: "Fix something",
      url: "https://github.com/some-org/some-repo/issues/42",
      bounty_amount: 500,
      bounty_formatted: "$500",
      labels: ["bounty"],
      body: "",
      comment_count: 0,
    });
    const result = formatBountyNotification(issue);
    expect(result).toContain("(Global)");
  });

  it("marks text-extracted amounts with a tilde", () => {
    const issue = makeIssue({
      bounty_amount: 250,
      bounty_formatted: "$250",
      bounty_confidence: "text_extract",
      bounty_currency: "unknown",
    });
    expect(formatBountyNotification(issue)).toContain("~$250");
  });

  it("shows API-confirmed amounts without a tilde", () => {
    const issue = makeIssue({
      source: "boss",
      bounty_amount: 1000,
      bounty_formatted: "$1,000",
      bounty_confidence: "api",
      bounty_currency: "USD",
    });
    const msg = formatBountyNotification(issue);
    expect(msg).toContain("$1,000");
    expect(msg).not.toContain("~$1,000");
  });

  it("shows legacy amounts without confidence metadata untouched", () => {
    const issue = makeIssue({ bounty_amount: 250, bounty_formatted: "$250" });
    const msg = formatBountyNotification(issue);
    expect(msg).toContain("$250");
    expect(msg).not.toContain("~$250");
  });
});
