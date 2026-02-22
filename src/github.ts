import { execFileSync } from "node:child_process";
import type { BountyIssue, GitHubAuthorAssociation, IssueComment } from "./types.js";

export interface IssueMetadata {
  body: string;
  labels: string[];
  assignees: string[];
  comment_count: number;
  created_at: string;
}

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
    "--json", "number,title,url,createdAt,labels,body,commentsCount,assignees",
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
    assignees: Array<{ login: string }>;
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
    assignees: issue.assignees.map((a) => a.login),
    body: issue.body,
    comment_count: issue.commentsCount,
    created_at: issue.createdAt,
    bounty_amount: extractBountyAmount(issue.title + " " + issue.body),
    bounty_formatted: extractBountyFormatted(issue.title),
  }));
}

export function buildIssueViewArgs(repo: string, number: number): string[] {
  return [
    "issue",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "comments",
  ];
}

export function fetchIssueComments(
  repo: string,
  number: number
): IssueComment[] {
  const args = buildIssueViewArgs(repo, number);
  const raw = execFileSync("gh", args, { encoding: "utf-8", timeout: 30000 });
  const data = JSON.parse(raw) as {
    comments: Array<{
      author: { login: string } | null;
      authorAssociation: string;
      body: string;
      createdAt: string;
      url: string;
    }>;
  };
  return data.comments.map((c) => ({
    author: c.author?.login ?? "ghost",
    authorAssociation: (c.authorAssociation ?? "NONE") as GitHubAuthorAssociation,
    body: c.body,
    createdAt: c.createdAt,
    url: c.url,
  }));
}

export function buildIssueMetadataArgs(repo: string, number: number): string[] {
  return [
    "issue",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "body,labels,assignees,createdAt,commentsCount",
  ];
}

export function fetchIssueMetadata(
  repo: string,
  number: number
): IssueMetadata {
  const args = buildIssueMetadataArgs(repo, number);
  const raw = execFileSync("gh", args, { encoding: "utf-8", timeout: 15000 });
  const data = JSON.parse(raw) as {
    body: string;
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    createdAt: string;
    commentsCount: number;
  };
  return {
    body: data.body,
    labels: data.labels.map((l) => l.name),
    assignees: data.assignees.map((a) => a.login),
    comment_count: data.commentsCount,
    created_at: data.createdAt,
  };
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
