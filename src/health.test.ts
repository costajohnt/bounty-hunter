import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HealthStore, FAILURE_ALERT_THRESHOLD } from "./health.js";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/bounty-hunter-test-health";
const path = join(TEST_DIR, "health.json");

describe("HealthStore", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("failure streaks", () => {
    it("requests an alert from the threshold onward until delivery is marked", () => {
      const h = new HealthStore(path);
      const results: boolean[] = [];
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD + 2; i++) {
        results.push(h.recordSourceFailure("boss.dev"));
      }
      // Keeps requesting (retry) because no delivery was ever marked
      expect(results).toEqual([false, false, true, true, true]);
    });

    it("stops requesting alerts once delivery is marked", () => {
      const h = new HealthStore(path);
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD; i++) h.recordSourceFailure("boss.dev");
      h.markFailureAlerted("boss.dev");
      expect(h.recordSourceFailure("boss.dev")).toBe(false);
      expect(h.recordSourceFailure("boss.dev")).toBe(false);
    });

    it("clears the delivered flag on success so the next streak alerts again", () => {
      const h = new HealthStore(path);
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD; i++) h.recordSourceFailure("x");
      h.markFailureAlerted("x");
      h.recordSourceSuccess("x", 1);
      const results: boolean[] = [];
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD; i++) {
        results.push(h.recordSourceFailure("x"));
      }
      expect(results[FAILURE_ALERT_THRESHOLD - 1]).toBe(true);
    });

    it("resets the streak on success so a new streak can alert again", () => {
      const h = new HealthStore(path);
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD; i++) h.recordSourceFailure("x");
      h.recordSourceSuccess("x", 0);
      const results: boolean[] = [];
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD; i++) {
        results.push(h.recordSourceFailure("x"));
      }
      expect(results[FAILURE_ALERT_THRESHOLD - 1]).toBe(true);
    });

    it("tracks streaks per source independently", () => {
      const h = new HealthStore(path);
      h.recordSourceFailure("a");
      h.recordSourceFailure("a");
      expect(h.recordSourceFailure("b")).toBe(false);
      expect(h.recordSourceFailure("a")).toBe(true);
    });
  });

  describe("persistence", () => {
    it("persists state across instances", () => {
      const h1 = new HealthStore(path);
      h1.recordSourceFailure("boss.dev");
      h1.recordSourceFailure("boss.dev");
      const h2 = new HealthStore(path);
      expect(h2.recordSourceFailure("boss.dev")).toBe(true);
    });

    it("recovers from a corrupt file by resetting instead of crashing", () => {
      writeFileSync(path, "not json");
      const h = new HealthStore(path);
      expect(h.recordSourceFailure("x")).toBe(false);
    });

    it("does not leave a temp file behind", () => {
      const h = new HealthStore(path);
      h.recordScan(1);
      expect(existsSync(`${path}.tmp`)).toBe(false);
    });
  });

  describe("heartbeat", () => {
    it("is due on a fresh store", () => {
      const h = new HealthStore(path);
      expect(h.heartbeatDue(24)).toBe(true);
    });

    it("is never due when disabled with 0", () => {
      const h = new HealthStore(path);
      expect(h.heartbeatDue(0)).toBe(false);
    });

    it("is not due again immediately after marking sent", () => {
      const h = new HealthStore(path);
      h.markHeartbeatSent();
      expect(h.heartbeatDue(24)).toBe(false);
    });

    it("stays due when the message was built but the send never confirmed", () => {
      const h = new HealthStore(path);
      h.buildHeartbeatMessage();
      expect(h.heartbeatDue(24)).toBe(true);
    });

    it("becomes due once the interval elapses", () => {
      const h = new HealthStore(path);
      h.markHeartbeatSent();
      const realNow = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(realNow + 25 * 60 * 60 * 1000);
      expect(h.heartbeatDue(24)).toBe(true);
    });

    it("summarizes scans and queued counts; counters reset only on mark", () => {
      const h = new HealthStore(path);
      h.recordScan(2);
      h.recordScan(0);
      h.recordScan(3);
      const msg = h.buildHeartbeatMessage();
      expect(msg).toContain("3 scans");
      expect(msg).toContain("5 bounties queued");
      // Building is a pure read; counters survive a failed send
      expect(h.buildHeartbeatMessage()).toContain("3 scans");
      h.markHeartbeatSent();
      const next = h.buildHeartbeatMessage();
      expect(next).toContain("0 scans");
      expect(next).toContain("0 bounties queued");
    });

    it("reports failing sources by name", () => {
      const h = new HealthStore(path);
      h.recordSourceSuccess("Expensify/App", 5);
      h.recordSourceFailure("boss.dev");
      const msg = h.buildHeartbeatMessage();
      expect(msg).toContain("Failing: boss.dev");
      expect(msg).toContain("1/2 OK");
    });

    it("flags sources that have not returned items for days", () => {
      const realNow = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(realNow - 5 * 24 * 60 * 60 * 1000);
      const h = new HealthStore(path);
      h.recordSourceSuccess("github_search", 4); // had items, 5 days ago
      vi.spyOn(Date, "now").mockReturnValue(realNow);
      const msg = h.buildHeartbeatMessage();
      expect(msg).toContain("No items for 3+ days: github_search");
    });

    it("does not flag a source that recently returned items", () => {
      const h = new HealthStore(path);
      h.recordSourceSuccess("github_search", 4);
      const msg = h.buildHeartbeatMessage();
      expect(msg).not.toContain("No items");
    });
  });
});
