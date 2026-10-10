import { describe, it, expect, vi, afterEach } from "vitest";
import { formatBountyNotification, sendTelegramMessage, retryAfterSeconds } from "./telegram.js";
import type { BountyIssue, VetResult } from "./types.js";

const makeIssue = (overrides: Partial<BountyIssue> = {}): BountyIssue => ({
  source: "github",
  repo: "Expensify/App",
  number: 81500,
  title: "Fix modal doesn't close on escape key",
  url: "https://github.com/Expensify/App/issues/81500",
  bounty_amount: 250,
  bounty_formatted: "$250",
  labels: ["Help Wanted", "Bug"],
  assignees: [],
  body: "Some description",
  comment_count: 0,
  created_at: "2026-02-05T12:00:00Z",
  ...overrides,
});

describe("formatBountyNotification", () => {
  it("formats a GitHub bounty issue (no vet result)", () => {
    const msg = formatBountyNotification(makeIssue());
    expect(msg).toContain("Expensify/App");
    expect(msg).toContain("#81500");
    expect(msg).toContain("$250");
    expect(msg).toContain("Proposals: 0");
    expect(msg).toContain("https://github.com/Expensify/App/issues/81500");
    // Default emoji when no vet result
    expect(msg).toContain("\ud83c\udfaf");
  });

  it("shows checkmark and OK for passed vetting", () => {
    const vetResult: VetResult = {
      passed: true,
      signals: [],
      proposal_count: 1,
      has_approved_proposal: false,
      summary: "Vetted: OK",
    };
    const msg = formatBountyNotification(makeIssue(), vetResult);
    expect(msg).toContain("\u2705"); // ✅
    expect(msg).toContain("Vetted: OK");
    expect(msg).toContain("Proposals: 1");
  });

  it("shows warning and summary for failed vetting", () => {
    const vetResult: VetResult = {
      passed: false,
      signals: [],
      proposal_count: 4,
      has_approved_proposal: false,
      summary: "Failed: access_requirements, competition",
    };
    const msg = formatBountyNotification(makeIssue(), vetResult);
    expect(msg).toContain("\u26a0\ufe0f"); // ⚠️
    expect(msg).toContain("Failed: access_requirements, competition");
    expect(msg).not.toContain("Vetted: Failed:"); // no redundant prefix
    expect(msg).toContain("Proposals: 4");
  });

  it("uses verified proposal_count instead of raw comment_count", () => {
    const issue = makeIssue({ comment_count: 15 });
    const vetResult: VetResult = {
      passed: true,
      signals: [],
      proposal_count: 2,
      has_approved_proposal: false,
      summary: "Vetted: OK",
    };
    const msg = formatBountyNotification(issue, vetResult);
    expect(msg).toContain("Proposals: 2");
    expect(msg).not.toContain("Proposals: 15");
  });

  it("shows (Boss) for boss issues", () => {
    const issue = makeIssue({
      source: "boss",
      repo: "org/repo",
      number: 3,
      title: "Add feature",
      url: "https://github.com/org/repo/issues/3",
      bounty_amount: 200,
      bounty_formatted: "$200",
      labels: [],
      body: "",
      comment_count: 0,
    });
    const result = formatBountyNotification(issue);
    expect(result).toContain("(Boss)");
  });

  it("shows (Global) for github_search issues", () => {
    const issue = makeIssue({
      source: "github_search",
      repo: "some-org/some-repo",
      number: 42,
      title: "Fix something",
      url: "https://github.com/some-org/some-repo/issues/42",
      bounty_amount: 500,
      bounty_formatted: "$500",
      labels: ["bounty"],
      body: "",
      comment_count: 0,
    });
    const result = formatBountyNotification(issue);
    expect(result).toContain("(Global)");
  });

  it("marks text-extracted amounts with a tilde", () => {
    const issue = makeIssue({
      bounty_amount: 250,
      bounty_formatted: "$250",
      bounty_confidence: "text_extract",
      bounty_currency: "unknown",
    });
    expect(formatBountyNotification(issue)).toContain("~$250");
  });

  it("shows API-confirmed amounts without a tilde", () => {
    const issue = makeIssue({
      source: "boss",
      bounty_amount: 1000,
      bounty_formatted: "$1,000",
      bounty_confidence: "api",
      bounty_currency: "USD",
    });
    const msg = formatBountyNotification(issue);
    expect(msg).toContain("$1,000");
    expect(msg).not.toContain("~$1,000");
  });

  it("shows legacy amounts without confidence metadata untouched", () => {
    const issue = makeIssue({ bounty_amount: 250, bounty_formatted: "$250" });
    const msg = formatBountyNotification(issue);
    expect(msg).toContain("$250");
    expect(msg).not.toContain("~$250");
  });
});

describe("formatBountyNotification footer", () => {
  it("does not promise a reply-to-skip feature that nothing reads", () => {
    expect(formatBountyNotification(makeIssue())).not.toMatch(/skip/i);
  });
});

describe("sendTelegramMessage", () => {
  const cfg = { bot_token: "t", chat_id: "c" };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const res = (status: number, body: string) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response;

  it("retries once after a 429, honoring retry_after", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, JSON.stringify({ ok: false, parameters: { retry_after: 0 } })))
      .mockResolvedValueOnce(res(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendTelegramMessage(cfg, "hi")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the single retry", async () => {
    const body = JSON.stringify({ ok: false, parameters: { retry_after: 0 } });
    const fetchMock = vi.fn().mockResolvedValue(res(429, body));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendTelegramMessage(cfg, "hi")).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(400, "bad request"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendTelegramMessage(cfg, "hi")).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses and caps retry_after", () => {
    expect(retryAfterSeconds(JSON.stringify({ parameters: { retry_after: 5 } }))).toBe(5);
    expect(retryAfterSeconds(JSON.stringify({ parameters: { retry_after: 3600 } }))).toBe(60);
    expect(retryAfterSeconds("not json")).toBeUndefined();
    expect(retryAfterSeconds("{}")).toBeUndefined();
  });
});
