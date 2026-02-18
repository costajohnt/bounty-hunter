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

export const WatchlistConfigSchema = z.object({
  polling_interval: z.number(),
  telegram: TelegramConfigSchema,
  sources: z.object({
    repos: z.array(RepoSourceSchema),
    algora: AlgoraSourceSchema,
  }),
  filters: FiltersObjectSchema.optional().default({
    ...FILTER_DEFAULTS,
    claimed_labels: [...FILTER_DEFAULTS.claimed_labels],
  }),
});

// Derive types from schemas
export type RepoSource = z.infer<typeof RepoSourceSchema>;
export type AlgoraSource = z.infer<typeof AlgoraSourceSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
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

export interface BountyIssue {
  source: "github" | "algora";
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
