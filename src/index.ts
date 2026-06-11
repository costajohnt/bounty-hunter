#!/usr/bin/env node

import { loadConfig, ensureDataDir, getDataDir } from "./config.js";
import { fetchRepoIssues, fetchIssueComments, fetchIssueMetadata } from "./github.js";
import { fetchGlobalBounties } from "./github-search.js";
import { fetchBossBounties, buildBossFilters } from "./boss.js";
import { SeenStore, effectiveRetentionDays } from "./seen.js";
import { sendTelegramMessage, formatBountyNotification } from "./telegram.js";
import { applyPreFilter, applyFreshnessFilter, resolveRepoFilters } from "./monitor.js";
import { vetIssue } from "./vet.js";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { BountyIssue, VetResult } from "./types.js";

interface ScanResult extends BountyIssue {
  is_new: boolean;
  vetResult?: VetResult;
}

const args = process.argv.slice(2);
const command = args[0];
const flags = args.includes("--json");

async function main() {
  switch (command) {
    case "scan": {
      const config = loadConfig();
      const dataDir = getDataDir();
      ensureDataDir(dataDir);
      const seen = new SeenStore(
        join(dataDir, "seen.json"),
        effectiveRetentionDays(config.seen_retention_days, config.filters.max_age_days)
      );
      const vettingEnabled = config.vetting.enabled;
      const allIssues: ScanResult[] = [];
      const seenThisScan = new Set<string>();

      for (const repo of config.sources.repos) {
        const repoFilters = resolveRepoFilters(config.filters, repo.filters);
        let issues: BountyIssue[];
        try {
          issues = fetchRepoIssues(repo.name, repo.labels);
        } catch (err) {
          console.error(`Error fetching ${repo.name}:`, err instanceof Error ? err.message : err);
          continue;
        }
        for (const issue of issues) {
          const issueKey = `${issue.repo}#${issue.number}`;
          if (seenThisScan.has(issueKey)) continue;
          seenThisScan.add(issueKey);
          if (!applyPreFilter(issue, repo.pre_filter)) continue;
          if (!applyFreshnessFilter(issue, repoFilters)) continue;

          let vetResult: VetResult | undefined;
          if (vettingEnabled) {
            try {
              const comments = fetchIssueComments(issue.repo, issue.number);
              vetResult = vetIssue(issue, comments, config.vetting);
            } catch (err) {
              console.error(
                `  Vetting error for ${issue.repo}#${issue.number}:`,
                err instanceof Error ? err.message : err
              );
            }
          }

          allIssues.push({
            ...issue,
            is_new: !seen.hasSeen(issue.repo, issue.number),
            ...(vetResult ? { vetResult } : {}),
          });
        }
      }

      // Poll GitHub Global Search
      if (config.sources.github_search?.enabled) {
        try {
          const watchedRepos = config.sources.repos.map((r) => r.name);
          const bounties = fetchGlobalBounties(config.sources.github_search, watchedRepos);
          for (const issue of bounties) {
            const issueKey = `${issue.repo}#${issue.number}`;
            if (seenThisScan.has(issueKey)) continue;
            seenThisScan.add(issueKey);
            if (!applyFreshnessFilter(issue, config.filters)) continue;

            let vetResult: VetResult | undefined;
            if (vettingEnabled) {
              try {
                const comments = fetchIssueComments(issue.repo, issue.number);
                vetResult = vetIssue(issue, comments, config.vetting);
              } catch (err) {
                console.error(
                  `  Vetting error for ${issue.repo}#${issue.number}:`,
                  err instanceof Error ? err.message : err
                );
              }
            }

            allIssues.push({
              ...issue,
              is_new: !seen.hasSeen(issue.repo, issue.number),
              ...(vetResult ? { vetResult } : {}),
            });
          }
        } catch (err) {
          console.error("Error fetching GitHub Global Search:", err instanceof Error ? err.message : err);
        }
      }

      // Poll Boss.dev
      if (config.sources.boss?.enabled) {
        const bossFilters = resolveRepoFilters(config.filters, config.sources.boss.filters);
        try {
          const bounties = await fetchBossBounties(buildBossFilters(config.sources.boss));
          for (const issue of bounties) {
            const issueKey = `${issue.repo}#${issue.number}`;
            if (seenThisScan.has(issueKey)) continue;
            seenThisScan.add(issueKey);

            // Enrich with GitHub metadata (real dates, labels, assignees, body)
            try {
              const meta = fetchIssueMetadata(issue.repo, issue.number);
              issue.body = meta.body;
              issue.labels = meta.labels;
              issue.assignees = meta.assignees;
              issue.comment_count = meta.comment_count;
              issue.created_at = meta.created_at;
            } catch (err) {
              console.warn(
                `Could not enrich ${issue.repo}#${issue.number} — filtering will use Boss.dev defaults (no age/label/assignee data):`,
                err instanceof Error ? err.message : err
              );
            }

            if (!applyFreshnessFilter(issue, bossFilters)) continue;

            let vetResult: VetResult | undefined;
            if (vettingEnabled) {
              try {
                const comments = fetchIssueComments(issue.repo, issue.number);
                vetResult = vetIssue(issue, comments, config.vetting);
              } catch (err) {
                console.error(
                  `  Vetting error for ${issue.repo}#${issue.number}:`,
                  err instanceof Error ? err.message : err
                );
              }
            }

            allIssues.push({
              ...issue,
              is_new: !seen.hasSeen(issue.repo, issue.number),
              ...(vetResult ? { vetResult } : {}),
            });
          }
        } catch (err) {
          console.error("Error fetching Boss.dev bounties:", err instanceof Error ? err.message : err);
        }
      }

      if (flags) {
        console.log(JSON.stringify(allIssues, null, 2));
      } else {
        for (const issue of allIssues) {
          const marker = issue.is_new ? "NEW" : "   ";
          const bounty = issue.bounty_formatted ?? "    ";
          const vet = issue.vetResult
            ? issue.vetResult.passed
              ? " \u2705"
              : " \u26a0\ufe0f"
            : "";
          console.log(`[${marker}] ${bounty.padEnd(8)} ${issue.repo}#${issue.number} — ${issue.title}${vet}`);
        }
      }
      break;
    }

    case "notify": {
      const config = loadConfig();
      const issueJson = args[1];
      if (!issueJson) { console.error("Usage: bounty-hunter notify <issue-json>"); process.exit(1); }
      let issue;
      try {
        issue = JSON.parse(issueJson);
      } catch {
        console.error("Invalid JSON. Usage: bounty-hunter notify '<json>'");
        process.exit(1);
      }
      await sendTelegramMessage(config.telegram, formatBountyNotification(issue));
      break;
    }

    case "post-comment": {
      const repoIdx = args.indexOf("--repo");
      const issueIdx = args.indexOf("--issue");
      const bodyIdx = args.indexOf("--body");
      if (repoIdx === -1 || issueIdx === -1 || bodyIdx === -1) {
        console.error("Usage: bounty-hunter post-comment --repo <repo> --issue <num> --body <file>");
        process.exit(1);
      }
      const repo = args[repoIdx + 1];
      const issueNum = args[issueIdx + 1];
      const bodyFile = args[bodyIdx + 1];
      if (!repo || !issueNum || !bodyFile || repo.startsWith("--") || issueNum.startsWith("--") || bodyFile.startsWith("--")) {
        console.error("Usage: bounty-hunter post-comment --repo <repo> --issue <num> --body <file>");
        process.exit(1);
      }
      execFileSync("gh", ["issue", "comment", issueNum, "--repo", repo, "--body-file", bodyFile], { stdio: "inherit" });
      break;
    }

    case "seen": {
      const dataDir = getDataDir();
      ensureDataDir(dataDir);
      const seen = new SeenStore(join(dataDir, "seen.json")); // manual state tool: never prunes
      if (args[1] === "--add") {
        const idArg = args[2] ?? "";
        const hashIdx = idArg.lastIndexOf("#");
        if (hashIdx === -1) { console.error("Usage: bounty-hunter seen --add <repo>#<number>"); process.exit(1); }
        const repo = idArg.slice(0, hashIdx);
        const num = idArg.slice(hashIdx + 1);
        seen.markSeen({
          id: idArg,
          repo,
          number: parseInt(num, 10),
          title: "",
          seen_at: new Date().toISOString(),
          skipped: false,
        });
        console.log(`Marked ${idArg} as seen`);
      }
      break;
    }

    case "config": {
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    default:
      console.log("Usage: bounty-hunter <scan|notify|post-comment|seen|config> [--json]");
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
