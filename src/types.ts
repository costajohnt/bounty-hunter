import { z } from "zod";

// --- Config schemas (Zod = single source of truth) ---

const FiltersOverrideSchema = z
  .object({
    max_age_days: z.number(),
    claimed_labels: z.array(z.string()),
    max_comment_count: z.number(),
    skip_assigned: z.boolean(),
  })
  .partial();

const RepoSourceSchema = z.object({
  name: z.string(),
  labels: z.array(z.string()),
  proposal_template: z.string(),
  pre_filter: z
    .object({
      keywords_exclude: z.array(z.string()).optional(),
    })
    .optional(),
  // Per-repo overrides of the global filters block. Repos like Expensify/App
  // auto-assign an engineer and accumulate bot comments within minutes, so
  // the global skip_assigned / max_comment_count defaults drop everything.
  filters: FiltersOverrideSchema.optional(),
});

export type FiltersOverride = z.infer<typeof FiltersOverrideSchema>;

export const GitHubSearchSourceSchema = z.object({
  enabled: z.boolean().default(false),
  labels: z.array(z.string()).default(["bounty"]),
  languages: z.array(z.string()).default([]),
  // Precision-first defaults: global search sweeps all of GitHub, where
  // low-star gamified "bounty" repos with no real payouts dominate results
  min_stars: z.number().default(200),
  keywords_exclude: z.array(z.string()).default([]),
  repos_exclude: z.array(z.string()).default([]),
  require_bounty_amount: z.boolean().default(true),
  max_results: z.number().default(50),
});

export const BossSourceSchema = z.object({
  // Enabled by default: Boss.dev is currently the most reliable bounty source
  enabled: z.boolean().default(true),
  min_bounty: z.number().default(0),
});

const TelegramConfigSchema = z.object({
  bot_token: z.string(),
  chat_id: z.string(),
});

const FILTER_DEFAULTS = {
  max_age_days: 7,
  claimed_labels: ["Reviewing", "Approved", "Assigned", "Under Review", "In Progress"],
  max_comment_count: 5,
  skip_assigned: true,
} as const;

const FiltersObjectSchema = z.object({
  max_age_days: z.number().default(FILTER_DEFAULTS.max_age_days),
  claimed_labels: z
    .array(z.string())
    .default([...FILTER_DEFAULTS.claimed_labels]),
  max_comment_count: z.number().default(FILTER_DEFAULTS.max_comment_count),
  skip_assigned: z.boolean().default(FILTER_DEFAULTS.skip_assigned),
});

export const FiltersSchema = FiltersObjectSchema;

const VETTING_DEFAULTS = {
  enabled: true,
  on_fail: "skip" as const,
  max_proposals: 3,
  access_keywords: [
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
  ],
  platform_keywords: [] as string[],
  proposal_patterns: ["## Proposal", "### Please re-state the problem"],
  require_bounty_label: false,
  bounty_labels: ["Help Wanted"],
} as const;

export const VettingConfigSchema = z.object({
  enabled: z.boolean().default(VETTING_DEFAULTS.enabled),
  on_fail: z
    .enum(["skip", "warn", "notify_all"])
    .default(VETTING_DEFAULTS.on_fail),
  max_proposals: z.number().int().min(0).default(VETTING_DEFAULTS.max_proposals),
  access_keywords: z
    .array(z.string())
    .default([...VETTING_DEFAULTS.access_keywords]),
  platform_keywords: z.array(z.string()).default([]),
  proposal_patterns: z
    .array(z.string())
    .default([...VETTING_DEFAULTS.proposal_patterns]),
  require_bounty_label: z
    .boolean()
    .default(VETTING_DEFAULTS.require_bounty_label),
  bounty_labels: z
    .array(z.string())
    .default([...VETTING_DEFAULTS.bounty_labels]),
});

export const WatchlistConfigSchema = z.object({
  polling_interval: z.number(),
  // Days to keep seen.json entries before pruning on load (0 = never prune)
  seen_retention_days: z.number().int().nonnegative().default(90),
  telegram: TelegramConfigSchema,
  sources: z.object({
    repos: z.array(RepoSourceSchema),
    github_search: GitHubSearchSourceSchema.optional(),
    boss: BossSourceSchema.optional(),
  }),
  filters: FiltersObjectSchema.optional().default({
    ...FILTER_DEFAULTS,
    claimed_labels: [...FILTER_DEFAULTS.claimed_labels],
  }),
  vetting: VettingConfigSchema.optional().default({
    enabled: VETTING_DEFAULTS.enabled,
    on_fail: VETTING_DEFAULTS.on_fail,
    max_proposals: VETTING_DEFAULTS.max_proposals,
    access_keywords: [...VETTING_DEFAULTS.access_keywords],
    platform_keywords: [...VETTING_DEFAULTS.platform_keywords],
    proposal_patterns: [...VETTING_DEFAULTS.proposal_patterns],
    require_bounty_label: VETTING_DEFAULTS.require_bounty_label,
    bounty_labels: [...VETTING_DEFAULTS.bounty_labels],
  }),
});

// Derive types from schemas
export type RepoSource = z.infer<typeof RepoSourceSchema>;
export type GitHubSearchSource = z.infer<typeof GitHubSearchSourceSchema>;
export type BossSource = z.infer<typeof BossSourceSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
export type VettingConfig = z.infer<typeof VettingConfigSchema>;
export type WatchlistConfig = z.infer<typeof WatchlistConfigSchema>;

// --- Non-config types (plain interfaces) ---

export interface SeenIssue {
  id: string;
  repo: string;
  number: number;
  title: string;
  seen_at: string;
  skipped: boolean;
}

export type BountySourceType = "github" | "github_search" | "boss";

// How trustworthy a bounty_amount is: platform-API-sourced amounts are
// validated; regex extraction from issue text can misread currencies,
// discussion mentions, or multiple amounts.
export type BountyConfidence = "api" | "text_extract";

export interface BountyIssue {
  source: BountySourceType;
  repo: string;
  number: number;
  title: string;
  url: string;
  bounty_amount?: number;
  bounty_formatted?: string;
  bounty_confidence?: BountyConfidence;
  bounty_currency?: "USD" | "unknown";
  labels: string[];
  assignees: string[];
  body: string;
  comment_count: number;
  created_at: string;
  tech?: string[];
}

export type GitHubAuthorAssociation =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIMER"
  | "FIRST_TIME_CONTRIBUTOR"
  | "MANNEQUIN"
  | "NONE";

export interface IssueComment {
  author: string;
  authorAssociation: GitHubAuthorAssociation;
  body: string;
  createdAt: string;
  url: string;
}

export type VetSignalName =
  | "access_requirements"
  | "competition"
  | "bounty_confirmation"
  | "platform_requirements";

export interface VetSignal {
  name: VetSignalName;
  passed: boolean;
  detail: string;
  found?: string[];
}

export interface VetResult {
  passed: boolean;
  signals: VetSignal[];
  proposal_count: number;
  has_approved_proposal: boolean;
  summary: string;
}
