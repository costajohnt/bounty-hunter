import { describe, it, expect } from "vitest";
import {
  checkAccessRequirements,
  checkCompetition,
  checkBountyConfirmation,
  checkPlatformRequirements,
  countProposals,
  vetIssue,
} from "./vet.js";
import type { BountyIssue, IssueComment, VettingConfig } from "./types.js";

// --- Helpers ---

const makeIssue = (overrides: Partial<BountyIssue> = {}): BountyIssue => ({
  source: "github",
  repo: "Expensify/App",
  number: 100,
  title: "Fix button",
  url: "https://github.com/Expensify/App/issues/100",
  labels: ["Help Wanted"],
  assignees: [],
  body: "Description of the bug",
  comment_count: 0,
  created_at: "2026-02-05T00:00:00Z",
  ...overrides,
});

const makeComment = (
  overrides: Partial<IssueComment> = {}
): IssueComment => ({
  author: "user123",
  authorAssociation: "NONE",
  body: "Some comment",
  createdAt: "2026-02-06T00:00:00Z",
  url: "https://github.com/Expensify/App/issues/100#issuecomment-1",
  ...overrides,
});

const defaultAccessKeywords = [
  "staging server",
  "staging environment",
  "internal tool",
  "internal slack",
  "internal stack overflow",
  "stackoverflow.com/c/",
  "vpn",
  "internal wiki",
  "century",
  "admin console",
  "internal dashboard",
  "dev environment",
  "test account provided",
];

const defaultProposalPatterns = [
  "## Proposal",
  "### Please re-state the problem",
];

const defaultVettingConfig: VettingConfig = {
  enabled: true,
  on_fail: "skip",
  max_proposals: 3,
  access_keywords: defaultAccessKeywords,
  platform_keywords: [],
  proposal_patterns: defaultProposalPatterns,
  require_bounty_label: false,
  bounty_labels: ["Help Wanted"],
};

// --- Access Requirements ---

describe("checkAccessRequirements", () => {
  it("passes when no access keywords found in body or comments", () => {
    const issue = makeIssue({ body: "Simple CSS bug" });
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(true);
  });

  it("fails when keyword found in issue body", () => {
    const issue = makeIssue({
      body: "To reproduce, log into the staging server and navigate to...",
    });
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("staging server");
    expect(result.found).toContain("staging server");
  });

  it("fails when keyword found in comments", () => {
    const issue = makeIssue();
    const comments = [
      makeComment({
        body: "You need access to the internal tool to test this",
      }),
    ];
    const result = checkAccessRequirements(issue, comments, defaultAccessKeywords);
    expect(result.passed).toBe(false);
    expect(result.found).toContain("internal tool");
  });

  it("is case-insensitive", () => {
    const issue = makeIssue({ body: "Use the STAGING SERVER to test" });
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(false);
  });

  it("detects internal URL patterns (*.internal.*)", () => {
    const issue = makeIssue({
      body: "Check results at dashboard.internal.company.com",
    });
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(false);
    expect(result.found).toContain("internal URL pattern");
  });

  it("detects internal URL patterns (*.corp.*)", () => {
    const issue = makeIssue({
      body: "Visit tools.corp.expensify.com for details",
    });
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(false);
    expect(result.found).toContain("internal URL pattern");
  });

  it("detects stackoverflow.com/c/ (private Teams SO)", () => {
    const issue = makeIssue({
      body: "See https://stackoverflow.com/c/expensify/questions/1234",
    });
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(false);
  });

  it("does not double-count stackoverflow.com/c/ from keyword + regex match", () => {
    const issue = makeIssue({
      body: "See https://stackoverflow.com/c/expensify/q/123",
    });
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(false);
    // Should only appear once, not twice
    const soMatches = result.found!.filter((f) => f.includes("stackoverflow"));
    expect(soMatches).toHaveLength(1);
  });

  it("does not false-positive on normal text", () => {
    const issue = makeIssue({
      body: "The server returns a 500 error when clicking the button. Internal state is corrupted.",
    });
    // "internal" alone is NOT a keyword — "internal tool", "internal slack", etc. are
    const result = checkAccessRequirements(issue, [], defaultAccessKeywords);
    expect(result.passed).toBe(true);
  });

  it("populates found array with all detected keywords", () => {
    const issue = makeIssue({ body: "Use the staging server and VPN" });
    const comments = [makeComment({ body: "Also check internal wiki" })];
    const result = checkAccessRequirements(issue, comments, defaultAccessKeywords);
    expect(result.passed).toBe(false);
    expect(result.found).toContain("staging server");
    expect(result.found).toContain("vpn");
    expect(result.found).toContain("internal wiki");
    expect(result.found!.length).toBeGreaterThanOrEqual(3);
  });

  it("passes when no keywords configured and no internal URLs", () => {
    const issue = makeIssue({ body: "Needs staging server" });
    const result = checkAccessRequirements(issue, [], []);
    // "staging server" is not a configured keyword, and no internal URL patterns present
    expect(result.passed).toBe(true);
  });

  it("still detects internal URL patterns even with empty keywords", () => {
    const issue = makeIssue({ body: "See dashboard.internal.company.com" });
    const result = checkAccessRequirements(issue, [], []);
    expect(result.passed).toBe(false);
    expect(result.found).toContain("internal URL pattern");
  });

  it("still detects *.corp.* URLs even with empty keywords", () => {
    const issue = makeIssue({ body: "Visit tools.corp.example.com" });
    const result = checkAccessRequirements(issue, [], []);
    expect(result.passed).toBe(false);
    expect(result.found).toContain("internal URL pattern");
  });
});

// --- Proposal Counting ---

describe("countProposals", () => {
  it("counts comments containing proposal patterns", () => {
    const comments = [
      makeComment({ body: "## Proposal\nHere is my fix..." }),
      makeComment({ body: "Great idea, +1" }),
      makeComment({ body: "## Proposal\nAlternative approach..." }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.count).toBe(2);
  });

  it("counts alternative proposal patterns", () => {
    const comments = [
      makeComment({
        body: "### Please re-state the problem\nThe button doesn't work",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.count).toBe(1);
  });

  it("returns 0 for no proposals", () => {
    const comments = [makeComment({ body: "Just a regular comment" })];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.count).toBe(0);
  });

  it("returns 0 for empty comments", () => {
    const result = countProposals([], defaultProposalPatterns);
    expect(result.count).toBe(0);
    expect(result.hasApproved).toBe(false);
  });

  it("detects approved proposal from MEMBER comment", () => {
    const comments = [
      makeComment({
        authorAssociation: "MEMBER",
        body: "Great proposal — you're hired!",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.hasApproved).toBe(true);
  });

  it("detects approved proposal from OWNER comment", () => {
    const comments = [
      makeComment({
        authorAssociation: "OWNER",
        body: "Offer sent, please check your email",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.hasApproved).toBe(true);
  });

  it("detects approved proposal from COLLABORATOR comment", () => {
    const comments = [
      makeComment({
        authorAssociation: "COLLABORATOR",
        body: "We have approved your proposal!",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.hasApproved).toBe(true);
  });

  it("ignores approval phrases from non-maintainers", () => {
    const comments = [
      makeComment({
        authorAssociation: "NONE",
        body: "I think they should be hired! You're hired in my eyes",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.hasApproved).toBe(false);
  });

  it("ignores approval phrases from CONTRIBUTOR", () => {
    const comments = [
      makeComment({
        authorAssociation: "CONTRIBUTOR",
        body: "Proposal approved by me!",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.hasApproved).toBe(false);
  });

  it("does not false-positive on generic 'approved' without proposal context", () => {
    const comments = [
      makeComment({
        authorAssociation: "MEMBER",
        body: "Design approved, moving to implementation",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.hasApproved).toBe(false);
  });

  it("is case-insensitive for proposal pattern matching", () => {
    const comments = [
      makeComment({ body: "## proposal\nmy approach..." }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.count).toBe(1);
  });

  it("handles a comment that is both a proposal and an approval", () => {
    const comments = [
      makeComment({
        authorAssociation: "MEMBER",
        body: "## Proposal\nApproved your proposal! This is the way to go.",
      }),
    ];
    const result = countProposals(comments, defaultProposalPatterns);
    expect(result.count).toBe(1);
    expect(result.hasApproved).toBe(true);
  });

  it("counts zero proposals but still detects approvals when patterns is empty", () => {
    const comments = [
      makeComment({
        authorAssociation: "MEMBER",
        body: "You're hired!",
      }),
    ];
    const result = countProposals(comments, []);
    expect(result.count).toBe(0);
    expect(result.hasApproved).toBe(true);
  });
});

// --- Competition ---

describe("checkCompetition", () => {
  it("passes when proposals are below threshold", () => {
    const result = checkCompetition({ count: 1, hasApproved: false }, 3);
    expect(result.passed).toBe(true);
  });

  it("fails when proposals meet threshold", () => {
    const result = checkCompetition({ count: 3, hasApproved: false }, 3);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("3 >= 3");
  });

  it("fails when proposals exceed threshold", () => {
    const result = checkCompetition({ count: 4, hasApproved: false }, 3);
    expect(result.passed).toBe(false);
  });

  it("fails instantly when a proposal is approved", () => {
    const result = checkCompetition({ count: 1, hasApproved: true }, 10);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("approved/hired");
  });

  it("passes when disabled (maxProposals = 0)", () => {
    const result = checkCompetition({ count: 5, hasApproved: false }, 0);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("disabled");
  });

  it("passes with zero proposals", () => {
    const result = checkCompetition({ count: 0, hasApproved: false }, 3);
    expect(result.passed).toBe(true);
  });

  it("passes when disabled even if a proposal is approved", () => {
    const result = checkCompetition({ count: 1, hasApproved: true }, 0);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("disabled");
  });
});

// --- Bounty Confirmation ---

describe("checkBountyConfirmation", () => {
  it("always passes for Boss.dev issues", () => {
    const issue = makeIssue({
      source: "boss",
      bounty_amount: undefined,
      labels: [],
    });
    const result = checkBountyConfirmation(issue, true, ["Help Wanted"]);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("Platform-confirmed");
  });

  it("passes when disabled (requireLabel = false)", () => {
    const issue = makeIssue({ bounty_amount: undefined, labels: [] });
    const result = checkBountyConfirmation(issue, false, ["Help Wanted"]);
    expect(result.passed).toBe(true);
  });

  it("passes when issue has bounty amount", () => {
    const issue = makeIssue({ bounty_amount: 500 });
    const result = checkBountyConfirmation(issue, true, ["Help Wanted"]);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("$500");
  });

  it("passes when issue has bounty label", () => {
    const issue = makeIssue({
      bounty_amount: undefined,
      labels: ["Help Wanted", "Bug"],
    });
    const result = checkBountyConfirmation(issue, true, ["Help Wanted"]);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("bounty label");
  });

  it("bounty label check is case-insensitive", () => {
    const issue = makeIssue({
      bounty_amount: undefined,
      labels: ["help wanted"],
    });
    const result = checkBountyConfirmation(issue, true, ["Help Wanted"]);
    expect(result.passed).toBe(true);
  });

  it("fails when no bounty amount and no bounty label", () => {
    const issue = makeIssue({
      bounty_amount: undefined,
      labels: ["Bug", "Enhancement"],
    });
    const result = checkBountyConfirmation(issue, true, ["Help Wanted"]);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("No bounty amount");
  });

  it("fails when bounty_amount is 0 and no bounty label present", () => {
    const issue = makeIssue({
      bounty_amount: 0,
      labels: ["Bug"],
    });
    const result = checkBountyConfirmation(issue, true, ["Help Wanted"]);
    expect(result.passed).toBe(false);
  });
});

// --- Platform Requirements ---

describe("checkPlatformRequirements", () => {
  it("passes when no platform keywords configured", () => {
    const issue = makeIssue({ body: "Anything goes" });
    const result = checkPlatformRequirements(issue, []);
    expect(result.passed).toBe(true);
  });

  it("fails when keyword found in body", () => {
    const issue = makeIssue({ body: "This requires iOS 17+ only" });
    const result = checkPlatformRequirements(issue, ["iOS 17"]);
    expect(result.passed).toBe(false);
    expect(result.found).toContain("iOS 17");
  });

  it("fails when keyword found in title", () => {
    const issue = makeIssue({ title: "[Android] Fix native crash" });
    const result = checkPlatformRequirements(issue, ["[Android]"]);
    expect(result.passed).toBe(false);
  });

  it("is case-insensitive", () => {
    const issue = makeIssue({ body: "Only affects WINDOWS users" });
    const result = checkPlatformRequirements(issue, ["windows"]);
    expect(result.passed).toBe(false);
  });

  it("passes when keywords not present", () => {
    const issue = makeIssue({ body: "Web-only CSS bug", title: "Fix CSS" });
    const result = checkPlatformRequirements(issue, ["iOS", "Android"]);
    expect(result.passed).toBe(true);
  });

  it("does not check comments (by design — platform tags are in issue metadata)", () => {
    // checkPlatformRequirements only takes issue, not comments
    const issue = makeIssue({ body: "Simple bug", title: "Fix crash" });
    const result = checkPlatformRequirements(issue, ["iOS"]);
    expect(result.passed).toBe(true);
  });
});

// --- Orchestrator ---

describe("vetIssue", () => {
  it("passes when all checks pass", () => {
    const issue = makeIssue({ body: "Simple bug", bounty_amount: 250 });
    const result = vetIssue(issue, [], defaultVettingConfig);
    expect(result.passed).toBe(true);
    expect(result.summary).toBe("Vetted: OK");
    expect(result.proposal_count).toBe(0);
    expect(result.has_approved_proposal).toBe(false);
  });

  it("fails when access requirements fail", () => {
    const issue = makeIssue({
      body: "Log into the staging server and test",
    });
    const result = vetIssue(issue, [], defaultVettingConfig);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("access_requirements");
    const accessSignal = result.signals.find((s) => s.name === "access_requirements");
    expect(accessSignal?.found).toContain("staging server");
  });

  it("populates found keywords on access signal via orchestrator", () => {
    const issue = makeIssue({
      body: "Needs VPN access and the staging server credentials",
    });
    const result = vetIssue(issue, [], defaultVettingConfig);
    const accessSignal = result.signals.find((s) => s.name === "access_requirements");
    expect(accessSignal?.found).toContain("vpn");
    expect(accessSignal?.found).toContain("staging server");
    expect(accessSignal!.found!.length).toBeGreaterThanOrEqual(2);
  });

  it("fails when competition check fails", () => {
    const issue = makeIssue();
    const comments = [
      makeComment({ body: "## Proposal\nFix 1" }),
      makeComment({ body: "## Proposal\nFix 2" }),
      makeComment({ body: "## Proposal\nFix 3" }),
    ];
    const result = vetIssue(issue, comments, defaultVettingConfig);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("competition");
    expect(result.proposal_count).toBe(3);
  });

  it("fails when multiple checks fail", () => {
    const issue = makeIssue({
      body: "Log into the staging server",
    });
    const comments = [
      makeComment({ body: "## Proposal\nFix 1" }),
      makeComment({ body: "## Proposal\nFix 2" }),
      makeComment({ body: "## Proposal\nFix 3" }),
    ];
    const result = vetIssue(issue, comments, defaultVettingConfig);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("access_requirements");
    expect(result.summary).toContain("competition");
  });

  it("includes correct proposal count in result", () => {
    const comments = [
      makeComment({ body: "## Proposal\nFix 1" }),
      makeComment({ body: "Just commenting" }),
      makeComment({ body: "## Proposal\nFix 2" }),
    ];
    const result = vetIssue(makeIssue(), comments, defaultVettingConfig);
    expect(result.proposal_count).toBe(2);
  });

  it("detects approved proposals", () => {
    const comments = [
      makeComment({ body: "## Proposal\nFix 1" }),
      makeComment({
        authorAssociation: "MEMBER",
        body: "Great, you're hired!",
      }),
    ];
    const result = vetIssue(makeIssue(), comments, defaultVettingConfig);
    expect(result.has_approved_proposal).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("generates correct summary for all-pass", () => {
    const result = vetIssue(makeIssue(), [], defaultVettingConfig);
    expect(result.summary).toBe("Vetted: OK");
    expect(result.signals.every((s) => s.passed)).toBe(true);
  });

  it("generates correct summary listing failed signal names", () => {
    const issue = makeIssue({ body: "Needs staging server access" });
    const config: VettingConfig = {
      ...defaultVettingConfig,
      platform_keywords: ["staging"],
    };
    const result = vetIssue(issue, [], config);
    expect(result.passed).toBe(false);
    // Both access_requirements and platform_requirements should fail
    expect(result.summary).toContain("access_requirements");
    expect(result.summary).toContain("platform_requirements");
  });

  it("uses custom config overrides", () => {
    const issue = makeIssue();
    const comments = [
      makeComment({ body: "## Proposal\nFix 1" }),
      makeComment({ body: "## Proposal\nFix 2" }),
      makeComment({ body: "## Proposal\nFix 3" }),
      makeComment({ body: "## Proposal\nFix 4" }),
      makeComment({ body: "## Proposal\nFix 5" }),
    ];
    // Raise the threshold so it passes
    const config: VettingConfig = {
      ...defaultVettingConfig,
      max_proposals: 10,
    };
    const result = vetIssue(issue, comments, config);
    expect(result.passed).toBe(true);
    expect(result.proposal_count).toBe(5);
  });
});
