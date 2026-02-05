export interface RepoSource {
  name: string;
  labels: string[];
  proposal_template: string;
  pre_filter?: {
    keywords_exclude?: string[];
  };
}

export interface AlgoraSource {
  enabled: boolean;
  min_bounty: number;
  languages: string[];
  keywords_exclude: string[];
}

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

export interface WatchlistConfig {
  polling_interval: number;
  telegram: TelegramConfig;
  sources: {
    repos: RepoSource[];
    algora: AlgoraSource;
  };
}

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
