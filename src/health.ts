import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";

// Consecutive failures of one source before an alert fires (once per streak)
export const FAILURE_ALERT_THRESHOLD = 3;

// A source with no items for this long gets flagged in the heartbeat
const DRY_SOURCE_DAYS = 3;

interface SourceHealth {
  last_ok?: string; // last run that completed without an error
  last_items?: string; // last run that returned at least one issue
  consecutive_failures: number;
  failure_alerted?: boolean; // an alert for the current streak was DELIVERED
}

interface HealthState {
  last_heartbeat_at?: string;
  scans_since_heartbeat: number;
  queued_since_heartbeat: number;
  sources: Record<string, SourceHealth>;
}

function emptyState(): HealthState {
  return {
    scans_since_heartbeat: 0,
    queued_since_heartbeat: 0,
    sources: {},
  };
}

/**
 * Persistent monitor self-health: scan counters, per-source success/failure
 * streaks, and heartbeat bookkeeping. The monitor has died silently twice
 * (disabled cron, dry sources); everything here exists so silence is loud.
 */
export class HealthStore {
  private path: string;
  private state: HealthState;

  constructor(path: string) {
    this.path = path;
    this.state = this.load();
  }

  private load(): HealthState {
    if (!existsSync(this.path)) return emptyState();
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8")) as HealthState;
      return {
        ...emptyState(),
        ...parsed,
        sources: parsed.sources ?? {},
      };
    } catch (err) {
      // Health data is derived bookkeeping; losing it only resets counters.
      // Warn loudly and start fresh rather than crashing the monitor.
      console.error(
        `HealthStore: ${this.path} is corrupt, resetting health state:`,
        err instanceof Error ? err.message : err
      );
      return emptyState();
    }
  }

  private save(): void {
    // Best-effort, mirroring the load path: health is derived bookkeeping,
    // and a disk hiccup here must never break bounty polling or notification
    // (recordScan runs between "marked seen" and "notified", so a throw
    // would permanently eat every bounty collected this run).
    try {
      // Write-then-rename so a crash mid-write can never truncate the live file
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      renameSync(tmp, this.path);
    } catch (err) {
      console.error(
        `HealthStore: failed to persist ${this.path} (health state may be stale):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  private source(name: string): SourceHealth {
    if (!this.state.sources[name]) {
      this.state.sources[name] = { consecutive_failures: 0 };
    }
    return this.state.sources[name];
  }

  /** Record a successful poll of one source. Resets its failure streak. */
  recordSourceSuccess(name: string, fetchedCount: number): void {
    const s = this.source(name);
    s.last_ok = new Date(Date.now()).toISOString();
    if (fetchedCount > 0) s.last_items = new Date(Date.now()).toISOString();
    s.consecutive_failures = 0;
    s.failure_alerted = false;
    this.save();
  }

  /**
   * Record a failed poll of one source. Returns true when the streak is at
   * or past FAILURE_ALERT_THRESHOLD and no alert for this streak has been
   * DELIVERED yet — the caller keeps retrying the alert each run until a
   * send succeeds, then calls markFailureAlerted.
   */
  recordSourceFailure(name: string): boolean {
    const s = this.source(name);
    s.consecutive_failures++;
    this.save();
    return (
      s.consecutive_failures >= FAILURE_ALERT_THRESHOLD && !s.failure_alerted
    );
  }

  /** Call after a failure-streak alert was actually delivered. */
  markFailureAlerted(name: string): void {
    this.source(name).failure_alerted = true;
    this.save();
  }

  /** Record one completed monitor run and how many issues it queued. */
  recordScan(queuedCount: number): void {
    this.state.scans_since_heartbeat++;
    this.state.queued_since_heartbeat += queuedCount;
    this.save();
  }

  /** True when the last heartbeat is older than the interval (0 = disabled). */
  heartbeatDue(intervalHours: number): boolean {
    if (intervalHours <= 0) return false;
    if (!this.state.last_heartbeat_at) return true;
    const elapsed = Date.now() - new Date(this.state.last_heartbeat_at).getTime();
    return elapsed >= intervalHours * 60 * 60 * 1000;
  }

  /** Builds the heartbeat text. Pure read; call markHeartbeatSent after the
   * message actually went out, so a failed send does not eat the heartbeat. */
  buildHeartbeatMessage(): string {
    const lines = [
      `bounty-hunter alive: ${this.state.scans_since_heartbeat} scans, ` +
        `${this.state.queued_since_heartbeat} bounties queued since last heartbeat.`,
    ];
    const names = Object.keys(this.state.sources);
    if (names.length > 0) {
      const failing = names.filter(
        (n) => this.state.sources[n].consecutive_failures > 0
      );
      const dryCutoff = Date.now() - DRY_SOURCE_DAYS * 24 * 60 * 60 * 1000;
      const dry = names.filter((n) => {
        const s = this.state.sources[n];
        if (s.consecutive_failures > 0) return false; // already listed as failing
        const lastItems = s.last_items ? new Date(s.last_items).getTime() : 0;
        return lastItems < dryCutoff;
      });
      const ok = names.length - failing.length - dry.length;
      lines.push(`Sources: ${ok}/${names.length} OK.`);
      if (failing.length > 0) lines.push(`Failing: ${failing.join(", ")}.`);
      if (dry.length > 0) {
        lines.push(`No items for ${DRY_SOURCE_DAYS}+ days: ${dry.join(", ")}.`);
      }
    }
    return lines.join("\n");
  }

  /** Resets the per-period counters after a heartbeat was delivered. */
  markHeartbeatSent(): void {
    this.state.last_heartbeat_at = new Date(Date.now()).toISOString();
    this.state.scans_since_heartbeat = 0;
    this.state.queued_since_heartbeat = 0;
    this.save();
  }
}
