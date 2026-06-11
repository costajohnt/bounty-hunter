import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SeenStore, effectiveRetentionDays } from "./seen.js";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BountyIssue } from "./types.js";

const TEST_DIR = "/tmp/bounty-hunter-test-seen";

describe("SeenStore", () => {
  let store: SeenStore;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    store = new SeenStore(join(TEST_DIR, "seen.json"));
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns false for unseen issues", () => {
    expect(store.hasSeen("Expensify/App", 81500)).toBe(false);
  });

  it("returns true after marking seen", () => {
    store.markSeen({
      id: "Expensify/App#81500",
      repo: "Expensify/App",
      number: 81500,
      title: "Fix modal",
      seen_at: new Date().toISOString(),
      skipped: false,
    });
    expect(store.hasSeen("Expensify/App", 81500)).toBe(true);
  });

  it("persists across instances", () => {
    store.markSeen({
      id: "Expensify/App#81500",
      repo: "Expensify/App",
      number: 81500,
      title: "Fix modal",
      seen_at: new Date().toISOString(),
      skipped: false,
    });
    const store2 = new SeenStore(join(TEST_DIR, "seen.json"));
    expect(store2.hasSeen("Expensify/App", 81500)).toBe(true);
  });

  it("marks issues as skipped", () => {
    store.markSkipped("Expensify/App", 81500);
    expect(store.hasSeen("Expensify/App", 81500)).toBe(true);
  });

  it("marks seen from a BountyIssue", () => {
    const bountyIssue: BountyIssue = {
      source: "github",
      repo: "Expensify/App",
      number: 99999,
      title: "Fix performance issue",
      url: "https://github.com/Expensify/App/issues/99999",
      bounty_amount: 500,
      bounty_formatted: "$500",
      labels: ["Help Wanted"],
      assignees: [],
      body: "Performance is slow",
      comment_count: 3,
      created_at: "2026-02-05T00:00:00Z",
    };
    store.markSeenFromBounty(bountyIssue);
    expect(store.hasSeen("Expensify/App", 99999)).toBe(true);
  });
});

describe("SeenStore retention pruning", () => {
  const path = join(TEST_DIR, "seen.json");

  function entry(number: number, ageDays: number) {
    return {
      id: `Expensify/App#${number}`,
      repo: "Expensify/App",
      number,
      title: `Issue ${number}`,
      seen_at: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString(),
      skipped: false,
    };
  }

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    const writer = new SeenStore(path);
    writer.markSeen(entry(1, 120)); // older than retention
    writer.markSeen(entry(2, 5)); // fresh
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("prunes entries older than retention on load", () => {
    const store = new SeenStore(path, 90);
    expect(store.hasSeen("Expensify/App", 1)).toBe(false);
    expect(store.hasSeen("Expensify/App", 2)).toBe(true);
  });

  it("persists the prune to disk", () => {
    new SeenStore(path, 90);
    // Reload with pruning disabled: the old entry must be gone from the file
    const reread = new SeenStore(path);
    expect(reread.hasSeen("Expensify/App", 1)).toBe(false);
    expect(reread.hasSeen("Expensify/App", 2)).toBe(true);
  });

  it("keeps everything when retention is 0", () => {
    const store = new SeenStore(path, 0);
    expect(store.hasSeen("Expensify/App", 1)).toBe(true);
    expect(store.hasSeen("Expensify/App", 2)).toBe(true);
  });

  it("keeps everything when retention is omitted", () => {
    const store = new SeenStore(path);
    expect(store.hasSeen("Expensify/App", 1)).toBe(true);
    expect(store.hasSeen("Expensify/App", 2)).toBe(true);
  });

  it("keeps entries with unparseable seen_at timestamps", () => {
    const writer = new SeenStore(path);
    writer.markSeen({ ...entry(3, 0), seen_at: "not-a-date" });
    const store = new SeenStore(path, 90);
    expect(store.hasSeen("Expensify/App", 3)).toBe(true);
  });

  it("does not leave a temp file behind after saving", () => {
    new SeenStore(path, 90); // triggers a prune-save
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(existsSync(path)).toBe(true);
  });

  it("throws a descriptive error on corrupt seen.json instead of starting empty", () => {
    writeFileSync(path, "not valid json");
    expect(() => new SeenStore(path, 90)).toThrow(/corrupt/);
    // The corrupt file must survive for manual recovery
    expect(readFileSync(path, "utf-8")).toBe("not valid json");
  });

  it("throws when seen.json is valid JSON but not an array", () => {
    writeFileSync(path, JSON.stringify({ nope: true }));
    expect(() => new SeenStore(path)).toThrow(/expected a JSON array/);
  });
});

describe("effectiveRetentionDays", () => {
  it("returns retention when it exceeds the freshness window", () => {
    expect(effectiveRetentionDays(90, 7)).toBe(90);
  });

  it("floors retention at max_age_days so pruning can never cause re-notification", () => {
    expect(effectiveRetentionDays(5, 30)).toBe(30);
  });

  it("returns 0 (never prune) when retention is 0, regardless of max_age_days", () => {
    expect(effectiveRetentionDays(0, 7)).toBe(0);
  });

  it("handles a disabled freshness window", () => {
    expect(effectiveRetentionDays(90, 0)).toBe(90);
  });
});
