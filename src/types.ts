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

export const WatchlistConfigSchema = z.object({
  polling_interval: z.number(),
  telegram: TelegramConfigSchema,
  sources: z.object({
    repos: z.array(RepoSourceSchema),
    algora: AlgoraSourceSchema,
  }),
});

// Derive types from schemas
export type RepoSource = z.infer<typeof RepoSourceSchema>;
export type AlgoraSource = z.infer<typeof AlgoraSourceSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
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
  body: string;
  comment_count: number;
  created_at: string;
  tech?: string[];
}
