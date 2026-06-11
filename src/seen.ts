import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import type { BountyIssue, SeenIssue } from "./types.js";

/**
 * Resolves the retention window actually used for pruning. Retention is
 * floored at max_age_days so an entry can never be pruned while its issue
 * is still inside the freshness window (which would let it re-notify).
 * A retention of 0 always means "never prune".
 */
export function effectiveRetentionDays(
  retentionDays: number,
  maxAgeDays: number
): number {
  if (retentionDays === 0) return 0;
  return Math.max(retentionDays, maxAgeDays);
}

export class SeenStore {
  private path: string;
  private data: Map<string, SeenIssue>;
  private retentionDays: number;

  constructor(path: string, retentionDays = 0) {
    this.path = path;
    this.data = new Map();
    this.retentionDays = retentionDays;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    let raw: SeenIssue[];
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8"));
      if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
      raw = parsed as SeenIssue[];
    } catch (err) {
      // Fail loudly rather than starting with an empty store, which would
      // silently re-notify every previously seen bounty.
      throw new Error(
        `SeenStore: ${this.path} is corrupt (${err instanceof Error ? err.message : err}). ` +
          `Fix or delete the file (deleting will re-notify all previously seen bounties).`
      );
    }
    const cutoff =
      this.retentionDays > 0
        ? Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
        : undefined;
    let pruned = 0;
    for (const issue of raw) {
      if (cutoff !== undefined) {
        const seenAt = new Date(issue.seen_at).getTime();
        // NaN comparisons are false, so unparseable timestamps are kept
        if (seenAt < cutoff) {
          pruned++;
          continue;
        }
      }
      this.data.set(issue.id, issue);
    }
    if (pruned > 0) {
      // stderr: scan --json emits machine-readable output on stdout
      console.error(
        `SeenStore: pruned ${pruned} entries older than ${this.retentionDays} days from ${this.path}`
      );
      this.save();
    }
  }

  private save(): void {
    // Write-then-rename so a crash mid-write can never truncate the live file
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.data.values()], null, 2));
    renameSync(tmp, this.path);
  }

  private makeId(repo: string, number: number): string {
    return `${repo}#${number}`;
  }

  hasSeen(repo: string, number: number): boolean {
    return this.data.has(this.makeId(repo, number));
  }

  markSeen(issue: SeenIssue): void {
    const id = this.makeId(issue.repo, issue.number);
    this.data.set(id, { ...issue, id });
    this.save();
  }

  markSeenFromBounty(issue: BountyIssue): void {
    this.markSeen({
      id: this.makeId(issue.repo, issue.number),
      repo: issue.repo,
      number: issue.number,
      title: issue.title,
      seen_at: new Date().toISOString(),
      skipped: false,
    });
  }

  markSkipped(repo: string, number: number): void {
    const id = this.makeId(repo, number);
    this.data.set(id, {
      id,
      repo,
      number,
      title: "",
      seen_at: new Date().toISOString(),
      skipped: true,
    });
    this.save();
  }
}
