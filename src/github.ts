import { execFileSync } from "node:child_process";
import type { BountyIssue } from "./types.js";

interface ParsedIssueUrl {
  owner: string;
  repo: string;
  number: number;
}

export function parseIssueUrl(url: string): ParsedIssueUrl {
  const match = url.replace(/\/$/, "").match(
    /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/
  );
  if (!match) throw new Error(`Invalid GitHub issue URL: ${url}`);
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export function buildSearchArgs(repo: string, labels: string[]): string[] {
  const args = [
    "search", "issues",
    "--repo", repo,
    "--state", "open",
    "--sort", "created",
    "--order", "desc",
    "--limit", "20",
    "--json", "number,title,url,createdAt,labels,body,commentsCount",
  ];
  for (const label of labels) {
    args.push("--label", label);
  }
  return args;
}

export function fetchRepoIssues(repo: string, labels: string[]): BountyIssue[] {
  const args = buildSearchArgs(repo, labels);
  const raw = execFileSync("gh", args, { encoding: "utf-8", timeout: 30000 });
  const issues = JSON.parse(raw) as Array<{
    number: number;
    title: string;
    url: string;
    createdAt: string;
    labels: Array<{ name: string }>;
    body: string;
    commentsCount: number;
  }>;

  return issues.map((issue) => ({
    source: "github" as const,
    repo,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    labels: issue.labels.map((l) => l.name),
    body: issue.body,
    comment_count: issue.commentsCount,
    created_at: issue.createdAt,
    bounty_amount: extractBountyAmount(issue.title + " " + issue.body),
    bounty_formatted: extractBountyFormatted(issue.title),
  }));
}

export function fetchIssueDetail(repo: string, number: number): string {
  return execFileSync("gh", [
    "issue", "view", String(number),
    "--repo", repo,
    "--json", "title,body,comments,state,labels,createdAt,author",
  ], { encoding: "utf-8", timeout: 30000 });
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
