import { describe, it, expect } from "vitest";
import { formatBountyNotification } from "./telegram.js";
import type { BountyIssue } from "./types.js";

describe("formatBountyNotification", () => {
  it("formats a GitHub bounty issue", () => {
    const issue: BountyIssue = {
      source: "github",
      repo: "Expensify/App",
      number: 81500,
      title: "Fix modal doesn't close on escape key",
      url: "https://github.com/Expensify/App/issues/81500",
      bounty_amount: 250,
      bounty_formatted: "$250",
      labels: ["Help Wanted", "Bug"],
      body: "Some description",
      comment_count: 0,
      created_at: "2026-02-05T12:00:00Z",
    };
    const msg = formatBountyNotification(issue);
    expect(msg).toContain("Expensify/App");
    expect(msg).toContain("#81500");
    expect(msg).toContain("$250");
    expect(msg).toContain("0");
    expect(msg).toContain("https://github.com/Expensify/App/issues/81500");
  });

  it("formats an Algora bounty issue", () => {
    const issue: BountyIssue = {
      source: "algora",
      repo: "coolify/coolify",
      number: 8154,
      title: "Add Debian 13 support",
      url: "https://github.com/coolify/coolify/issues/8154",
      bounty_amount: 6900,
      bounty_formatted: "$6,900",
      labels: [],
      body: "",
      comment_count: 0,
      created_at: "2026-02-05T12:00:00Z",
      tech: ["php", "vue"],
    };
    const msg = formatBountyNotification(issue);
    expect(msg).toContain("$6,900");
    expect(msg).toContain("Algora");
  });
});
