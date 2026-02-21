import { z } from "zod";

// --- Config schemas (Zod = single source of truth) ---

const RepoSourceSchema = z.object({
  name: z.string(),
  labels: z.array(z.string()),
  proposal_template: z.string(),
  pre_filter: z
    .object({
      keywords_exclude: z.array(z.string()).optional(),
    })
    .optional(),
});

const AlgoraSourceSchema = z.object({
  enabled: z.boolean(),
  min_bounty: z.number(),
  languages: z.array(z.string()),
  keywords_exclude: z.array(z.string()),
  max_pages: z.number().default(3),
});

export const GitHubSearchSourceSchema = z.object({
  enabled: z.boolean().default(false),
  labels: z.array(z.string()).default(["bounty"]),
  languages: z.array(z.string()).default([]),
  min_stars: z.number().default(0),
  keywords_exclude: z.array(z.string()).default([]),
  max_results: z.number().default(50),
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
  telegram: TelegramConfigSchema,
  sources: z.object({
    repos: z.array(RepoSourceSchema),
    algora: AlgoraSourceSchema,
    github_search: GitHubSearchSourceSchema.optional(),
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
export type AlgoraSource = z.infer<typeof AlgoraSourceSchema>;
export type GitHubSearchSource = z.infer<typeof GitHubSearchSourceSchema>;
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

export type BountySourceType = "github" | "algora" | "github_search";

export interface BountyIssue {
  source: BountySourceType;
  repo: string;
  number: number;
  title: string;
  url: string;
  bounty_amount?: number;
  bounty_formatted?: string;
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
