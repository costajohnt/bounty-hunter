import type {
  BountyIssue,
  IssueComment,
  VetSignal,
  VetResult,
  VettingConfig,
} from "./types.js";

// Internal URL patterns that suggest the issue requires private access
const INTERNAL_URL_RE = /\b\w+\.(internal|corp)\.\w+/i;
const INTERNAL_SO_RE = /stackoverflow\.com\/c\//i;

// Phrases from maintainers that indicate someone is already hired/approved
const APPROVED_PHRASES = [
  "you're hired",
  "you are hired",
  "offer sent",
  "approved",
  "assigned to you",
];

const MAINTAINER_ASSOCIATIONS = new Set([
  "MEMBER",
  "OWNER",
  "COLLABORATOR",
]);

/**
 * Checks if the issue body or comments reference internal/private access tools.
 */
export function checkAccessRequirements(
  issue: BountyIssue,
  comments: IssueComment[],
  keywords: string[]
): VetSignal {
  if (keywords.length === 0) {
    return { name: "access_requirements", passed: true, detail: "No access keywords configured" };
  }

  const allText = [
    issue.body,
    ...comments.map((c) => c.body),
  ]
    .join("\n")
    .toLowerCase();

  const found: string[] = [];

  for (const kw of keywords) {
    if (allText.includes(kw.toLowerCase())) {
      found.push(kw);
    }
  }

  // Also check for internal URL patterns
  const fullText = [issue.body, ...comments.map((c) => c.body)].join("\n");
  if (INTERNAL_URL_RE.test(fullText)) {
    found.push("internal URL pattern");
  }
  if (INTERNAL_SO_RE.test(fullText)) {
    // Only add if "stackoverflow.com/c/" wasn't already matched as a keyword
    if (!found.some((f) => f.toLowerCase().includes("stackoverflow.com/c/"))) {
      found.push("stackoverflow.com/c/");
    }
  }

  if (found.length > 0) {
    return {
      name: "access_requirements",
      passed: false,
      detail: `Found access keywords: ${found.join(", ")}`,
    };
  }

  return { name: "access_requirements", passed: true, detail: "No access issues detected" };
}

/**
 * Counts proposals in issue comments using configurable heading patterns.
 * Also detects approved/hired proposals from maintainer comments.
 */
export function countProposals(
  comments: IssueComment[],
  patterns: string[]
): { count: number; hasApproved: boolean } {
  let count = 0;
  let hasApproved = false;

  for (const comment of comments) {
    const bodyLower = comment.body.toLowerCase();

    // Check if this comment contains a proposal
    const isProposal = patterns.some((p) =>
      bodyLower.includes(p.toLowerCase())
    );
    if (isProposal) {
      count++;
    }

    // Check if a maintainer has approved/hired someone
    if (MAINTAINER_ASSOCIATIONS.has(comment.authorAssociation)) {
      for (const phrase of APPROVED_PHRASES) {
        if (bodyLower.includes(phrase)) {
          hasApproved = true;
          break;
        }
      }
    }
  }

  return { count, hasApproved };
}

/**
 * Checks if there are too many competing proposals or if someone is already hired.
 */
export function checkCompetition(
  comments: IssueComment[],
  patterns: string[],
  maxProposals: number
): VetSignal {
  // max_proposals = 0 means disabled
  if (maxProposals === 0) {
    return { name: "competition", passed: true, detail: "Competition check disabled" };
  }

  const { count, hasApproved } = countProposals(comments, patterns);

  if (hasApproved) {
    return {
      name: "competition",
      passed: false,
      detail: `A proposal has been approved/hired (${count} total proposals)`,
    };
  }

  if (count >= maxProposals) {
    return {
      name: "competition",
      passed: false,
      detail: `Too many proposals: ${count} >= ${maxProposals}`,
    };
  }

  return {
    name: "competition",
    passed: true,
    detail: `${count} proposal(s), below threshold of ${maxProposals}`,
  };
}

/**
 * Checks that the issue actually has a confirmed bounty (amount or label).
 * Always passes for Algora issues (bounties are confirmed by the platform).
 */
export function checkBountyConfirmation(
  issue: BountyIssue,
  requireLabel: boolean,
  labels: string[]
): VetSignal {
  // Algora issues have platform-confirmed bounties
  if (issue.source === "algora") {
    return { name: "bounty_confirmation", passed: true, detail: "Algora bounty (platform-confirmed)" };
  }

  if (!requireLabel) {
    return { name: "bounty_confirmation", passed: true, detail: "Bounty label check disabled" };
  }

  // Pass if the issue has a bounty amount
  if (issue.bounty_amount && issue.bounty_amount > 0) {
    return { name: "bounty_confirmation", passed: true, detail: `Bounty amount: $${issue.bounty_amount}` };
  }

  // Pass if the issue has a bounty label
  const labelsLower = labels.map((l) => l.toLowerCase());
  const hasLabel = issue.labels.some((l) =>
    labelsLower.includes(l.toLowerCase())
  );
  if (hasLabel) {
    return { name: "bounty_confirmation", passed: true, detail: "Has bounty label" };
  }

  return {
    name: "bounty_confirmation",
    passed: false,
    detail: "No bounty amount and no bounty label found",
  };
}

/**
 * Checks if the issue body mentions platform-specific requirements.
 */
export function checkPlatformRequirements(
  issue: BountyIssue,
  keywords: string[]
): VetSignal {
  if (keywords.length === 0) {
    return { name: "platform_requirements", passed: true, detail: "No platform keywords configured" };
  }

  const text = (issue.title + "\n" + issue.body).toLowerCase();
  const found: string[] = [];

  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) {
      found.push(kw);
    }
  }

  if (found.length > 0) {
    return {
      name: "platform_requirements",
      passed: false,
      detail: `Platform requirements found: ${found.join(", ")}`,
    };
  }

  return { name: "platform_requirements", passed: true, detail: "No platform issues detected" };
}

/**
 * Orchestrates all vetting checks and produces a summary result.
 */
export function vetIssue(
  issue: BountyIssue,
  comments: IssueComment[],
  config: VettingConfig
): VetResult {
  const signals: VetSignal[] = [
    checkAccessRequirements(issue, comments, config.access_keywords),
    checkCompetition(comments, config.proposal_patterns, config.max_proposals),
    checkBountyConfirmation(
      issue,
      config.require_bounty_label,
      config.bounty_labels
    ),
    checkPlatformRequirements(issue, config.platform_keywords),
  ];

  const { count, hasApproved } = countProposals(
    comments,
    config.proposal_patterns
  );

  const accessSignal = signals.find((s) => s.name === "access_requirements")!;
  const platformSignal = signals.find((s) => s.name === "platform_requirements")!;

  const accessKeywordsFound = accessSignal.passed
    ? []
    : extractKeywordsFromDetail(accessSignal.detail);
  const platformKeywordsFound = platformSignal.passed
    ? []
    : extractKeywordsFromDetail(platformSignal.detail);

  const passed = signals.every((s) => s.passed);
  const failedSignals = signals.filter((s) => !s.passed);

  const summary = passed
    ? "Vetted: OK"
    : `Failed: ${failedSignals.map((s) => s.name).join(", ")}`;

  return {
    passed,
    signals,
    proposal_count: count,
    has_approved_proposal: hasApproved,
    access_keywords_found: accessKeywordsFound,
    platform_keywords_found: platformKeywordsFound,
    summary,
  };
}

function extractKeywordsFromDetail(detail: string): string[] {
  const match = detail.match(/: (.+)$/);
  if (!match) return [];
  return match[1].split(", ");
}
