import { execFileSync } from "node:child_process";
import type { BountyIssue, GitHubSearchSource } from "./types.js";

interface GHSearchResult {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  body: string;
  commentsCount: number;
  repository: { nameWithOwner: string; stargazerCount: number };
}

function extractBountyAmount(text: string): number | undefined {
  const match = text.match(/\$(\d[\d,]*)/);
  if (!match) return undefined;
  return parseInt(match[1].replace(/,/g, ""), 10);
}

function extractBountyFormatted(text: string): string | undefined {
  const match = text.match(/(\$\d[\d,]*)/);
  return match?.[1];
}

export function buildGlobalSearchArgs(config: GitHubSearchSource, label: string): string[] {
  const args = [
    "search", "issues",
    "--state", "open",
    "--sort", "created",
    "--order", "desc",
    "--limit", String(config.max_results),
    "--json", "number,title,url,createdAt,labels,body,commentsCount,assignees,repository",
    "--label", label,
  ];
  // gh only supports one --language flag; use first configured language
  if (config.languages.length > 0) {
    args.push("--language", config.languages[0]);
  }
  return args;
}

export function parseGlobalSearchResults(
  raw: string,
  config: GitHubSearchSource,
  watchedRepos?: string[],
): BountyIssue[] {
  const results = JSON.parse(raw) as GHSearchResult[];

  return results
    .filter((item) => {
      if (config.min_stars > 0 && item.repository.stargazerCount < config.min_stars) {
        return false;
      }
      if (watchedRepos?.includes(item.repository.nameWithOwner)) {
        return false;
      }
      if (config.keywords_exclude.length > 0) {
        const text = (item.title + " " + item.body).toLowerCase();
        if (config.keywords_exclude.some((kw) => text.includes(kw.toLowerCase()))) {
          return false;
        }
      }
      return true;
    })
    .map((item) => ({
      source: "github_search" as const,
      repo: item.repository.nameWithOwner,
      number: item.number,
      title: item.title,
      url: item.url,
      labels: item.labels.map((l) => l.name),
      assignees: item.assignees.map((a) => a.login),
      body: item.body,
      comment_count: item.commentsCount,
      created_at: item.createdAt,
      bounty_amount: extractBountyAmount(item.title + " " + item.body),
      bounty_formatted: extractBountyFormatted(item.title) ?? extractBountyFormatted(item.body),
      bounty_confidence: extractBountyAmount(item.title + " " + item.body) ? "low" : undefined,
      bounty_confidence_reason: extractBountyAmount(item.title + " " + item.body)
        ? "GitHub text regex extraction; verify manually"
        : undefined,
    }));
}

export function fetchGlobalBounties(
  config: GitHubSearchSource,
  watchedRepos?: string[],
): BountyIssue[] {
  const seenUrls = new Set<string>();
  const allBounties: BountyIssue[] = [];

  let failedLabels = 0;

  for (const label of config.labels) {
    const args = buildGlobalSearchArgs(config, label);
    let raw: string;
    try {
      raw = execFileSync("gh", args, { encoding: "utf-8", timeout: 30000 });
    } catch (err) {
      failedLabels++;
      console.error(
        `  GitHub Search: failed to fetch label "${label}":`,
        err instanceof Error ? err.message : err
      );
      continue;
    }
    const bounties = parseGlobalSearchResults(raw, config, watchedRepos);
    for (const bounty of bounties) {
      if (!seenUrls.has(bounty.url)) {
        seenUrls.add(bounty.url);
        allBounties.push(bounty);
      }
    }
  }

  if (failedLabels === config.labels.length && config.labels.length > 0) {
    throw new Error(
      `GitHub Global Search: all ${failedLabels} label searches failed. Check that 'gh' is installed and authenticated (gh auth status).`
    );
  }

  return allBounties;
}
