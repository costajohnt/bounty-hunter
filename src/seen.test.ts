import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SeenStore } from "./seen.js";
import { mkdirSync, rmSync } from "node:fs";
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
