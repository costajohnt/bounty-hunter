import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { loadConfig, ensureDataDir, getDataDir } from "./config.js";
import { fetchRepoIssues, fetchIssueComments, fetchIssueMetadata } from "./github.js";
import { fetchAlgoraBounties, buildAlgoraFilters } from "./algora.js";
import { fetchGlobalBounties } from "./github-search.js";
import { fetchBossBounties, buildBossFilters } from "./boss.js";
import { SeenStore } from "./seen.js";
import { sendTelegramMessage, formatBountyNotification } from "./telegram.js";
import { vetIssue } from "./vet.js";
import type {
  BountyIssue,
  Filters,
  RepoSource,
  VetResult,
  VettingConfig,
} from "./types.js";

export function applyPreFilter(issue: BountyIssue, filter: RepoSource["pre_filter"]): boolean {
  if (!filter?.keywords_exclude?.length) return true;
  const text = (issue.title + " " + issue.body).toLowerCase();
  return !filter.keywords_exclude.some((kw) => text.includes(kw.toLowerCase()));
}

export function applyFreshnessFilter(issue: BountyIssue, filters: Filters): boolean {
  // Age check (both sources)
  if (filters.max_age_days > 0) {
    const ageMs = Date.now() - new Date(issue.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > filters.max_age_days) return false;
  }

  // GitHub-specific checks — Algora handles claiming at the API level and
  // hardcodes assignees/labels/comment_count to empty/zero, so these only
  // provide useful signal for GitHub issues.
  if (issue.source === "github" || issue.source === "github_search") {
    if (filters.skip_assigned && issue.assignees.length > 0) return false;

    if (filters.claimed_labels.length > 0) {
      const claimedLower = filters.claimed_labels.map((l) => l.toLowerCase());
      if (issue.labels.some((l) => claimedLower.includes(l.toLowerCase()))) return false;
    }

    if (filters.max_comment_count > 0 && issue.comment_count >= filters.max_comment_count) {
      return false;
    }
  }

  return true;
}

/**
 * Determines whether to notify for an issue based on vetting result and on_fail mode.
 * Returns true if a Telegram message should be sent.
 */
export function shouldNotify(
  vetResult: VetResult | undefined,
  onFail: VettingConfig["on_fail"]
): boolean {
  if (!vetResult) return true; // No vetting = always notify
  if (vetResult.passed) return true;

  switch (onFail) {
    case "skip":
      return false;
    case "warn":
      return true;
    case "notify_all":
      return true;
    default: {
      const _exhaustive: never = onFail;
      return _exhaustive;
    }
  }
}

export async function runMonitor(): Promise<void> {
  const config = loadConfig();
  const dataDir = getDataDir();
  ensureDataDir(dataDir);
  const seen = new SeenStore(join(dataDir, "seen.json"));
  const vettingEnabled = config.vetting.enabled;

  const allNew: Array<{ issue: BountyIssue; vetResult?: VetResult }> = [];

  // Poll GitHub repos
  for (const repo of config.sources.repos) {
    try {
      const issues = fetchRepoIssues(repo.name, repo.labels);
      for (const issue of issues) {
        if (seen.hasSeen(issue.repo, issue.number)) continue;
        if (!applyPreFilter(issue, repo.pre_filter)) continue;
        if (!applyFreshnessFilter(issue, config.filters)) continue;

        // Mark seen regardless of vetting outcome to prevent re-checking
        seen.markSeenFromBounty(issue);

        // Vet the issue if enabled
        let vetResult: VetResult | undefined;
        if (vettingEnabled) {
          try {
            const comments = fetchIssueComments(issue.repo, issue.number);
            vetResult = vetIssue(issue, comments, config.vetting);
          } catch (err) {
            // Broken vetting should never silently drop bounties — notify anyway
            console.error(
              `  Vetting error for ${issue.repo}#${issue.number}:`,
              err
            );
          }
        }

        allNew.push({ issue, vetResult });
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
        if (!applyFreshnessFilter(issue, config.filters)) continue;

        seen.markSeenFromBounty(issue);

        // Vet Algora issues with empty comments (body-based checks still apply)
        let vetResult: VetResult | undefined;
        if (vettingEnabled) {
          vetResult = vetIssue(issue, [], config.vetting);
        }

        allNew.push({ issue, vetResult });
      }
    } catch (err) {
      console.error("Error polling Algora:", err);
    }
  }

  // Poll GitHub Global Search
  if (config.sources.github_search?.enabled) {
    try {
      const watchedRepos = config.sources.repos.map((r) => r.name);
      const bounties = fetchGlobalBounties(config.sources.github_search, watchedRepos);
      for (const issue of bounties) {
        if (seen.hasSeen(issue.repo, issue.number)) continue;
        if (!applyFreshnessFilter(issue, config.filters)) continue;

        seen.markSeenFromBounty(issue);

        let vetResult: VetResult | undefined;
        if (vettingEnabled) {
          try {
            const comments = fetchIssueComments(issue.repo, issue.number);
            vetResult = vetIssue(issue, comments, config.vetting);
          } catch (err) {
            console.error(
              `  Vetting error for ${issue.repo}#${issue.number}:`,
              err
            );
          }
        }

        allNew.push({ issue, vetResult });
      }
    } catch (err) {
      console.error("Error polling GitHub Global Search:", err);
    }
  }

  // Poll Boss.dev
  if (config.sources.boss?.enabled) {
    try {
      const bounties = await fetchBossBounties(buildBossFilters(config.sources.boss));
      for (const issue of bounties) {
        if (seen.hasSeen(issue.repo, issue.number)) continue;

        // Enrich with GitHub metadata (real dates, labels, assignees, body)
        try {
          const meta = fetchIssueMetadata(issue.repo, issue.number);
          issue.body = meta.body;
          issue.labels = meta.labels;
          issue.assignees = meta.assignees;
          issue.comment_count = meta.comment_count;
          issue.created_at = meta.created_at;
        } catch (err) {
          console.warn(`Could not enrich ${issue.repo}#${issue.number}:`, err);
        }

        if (!applyFreshnessFilter(issue, config.filters)) continue;

        seen.markSeenFromBounty(issue);

        let vetResult: VetResult | undefined;
        if (vettingEnabled) {
          try {
            const comments = fetchIssueComments(issue.repo, issue.number);
            vetResult = vetIssue(issue, comments, config.vetting);
          } catch (err) {
            console.error(
              `  Vetting error for ${issue.repo}#${issue.number}:`,
              err
            );
          }
        }

        allNew.push({ issue, vetResult });
      }
    } catch (err) {
      console.error("Error polling Boss.dev:", err);
    }
  }

  // Notify
  if (allNew.length === 0) {
    console.log(`[${new Date().toISOString()}] No new bounties found.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] Found ${allNew.length} new bounties!`);

  for (const { issue, vetResult } of allNew) {
    if (!shouldNotify(vetResult, config.vetting.on_fail)) {
      console.log(`  Skipped (vetting): ${issue.repo}#${issue.number} — ${vetResult?.summary}`);
      continue;
    }

    try {
      const message = formatBountyNotification(issue, vetResult);
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
  runMonitor().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
