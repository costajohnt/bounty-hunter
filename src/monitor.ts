import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { loadConfig, ensureDataDir, getDataDir } from "./config.js";
import { fetchRepoIssues } from "./github.js";
import { fetchAlgoraBounties, buildAlgoraFilters } from "./algora.js";
import { SeenStore } from "./seen.js";
import { sendTelegramMessage, formatBountyNotification } from "./telegram.js";
import type { BountyIssue, RepoSource } from "./types.js";

export function applyPreFilter(issue: BountyIssue, filter: RepoSource["pre_filter"]): boolean {
  if (!filter?.keywords_exclude?.length) return true;
  const text = (issue.title + " " + issue.body).toLowerCase();
  return !filter.keywords_exclude.some((kw) => text.includes(kw.toLowerCase()));
}

export async function runMonitor(): Promise<void> {
  const config = loadConfig();
  const dataDir = getDataDir();
  ensureDataDir(dataDir);
  const seen = new SeenStore(join(dataDir, "seen.json"));

  const allNew: BountyIssue[] = [];

  // Poll GitHub repos
  for (const repo of config.sources.repos) {
    try {
      const issues = fetchRepoIssues(repo.name, repo.labels);
      for (const issue of issues) {
        if (seen.hasSeen(issue.repo, issue.number)) continue;
        if (!applyPreFilter(issue, repo.pre_filter)) continue;
        allNew.push(issue);
        seen.markSeenFromBounty(issue);
      }
    } catch (err) {
      console.error(`Error polling ${repo.name}:`, err);
    }
  }

  // Poll Algora
  if (config.sources.algora?.enabled) {
    try {
      const bounties = await fetchAlgoraBounties(buildAlgoraFilters(config.sources.algora));
      for (const issue of bounties) {
        if (seen.hasSeen(issue.repo, issue.number)) continue;
        allNew.push(issue);
        seen.markSeenFromBounty(issue);
      }
    } catch (err) {
      console.error("Error polling Algora:", err);
    }
  }

  // Notify
  if (allNew.length === 0) {
    console.log(`[${new Date().toISOString()}] No new bounties found.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] Found ${allNew.length} new bounties!`);

  for (const issue of allNew) {
    try {
      const message = formatBountyNotification(issue);
      await sendTelegramMessage(config.telegram, message);
      console.log(`  Notified: ${issue.repo}#${issue.number}`);
    } catch (err) {
      console.error(`  Failed to notify ${issue.repo}#${issue.number}:`, err);
    }
  }
}

// Entry point when run directly
const isMain = fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runMonitor().catch(console.error);
}
