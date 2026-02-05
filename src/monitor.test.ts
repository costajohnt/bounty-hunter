import { describe, it, expect } from "vitest";
import { applyPreFilter } from "./monitor.js";
import type { BountyIssue } from "./types.js";

const makeIssue = (overrides: Partial<BountyIssue> = {}): BountyIssue => ({
  source: "github",
  repo: "Expensify/App",
  number: 100,
  title: "Fix button",
  url: "https://github.com/Expensify/App/issues/100",
  labels: ["Help Wanted"],
  body: "Description",
  comment_count: 0,
  created_at: "2026-02-05T00:00:00Z",
  ...overrides,
});

describe("applyPreFilter", () => {
  it("passes issues with no exclude keywords", () => {
    const result = applyPreFilter(makeIssue(), {});
    expect(result).toBe(true);
  });

  it("excludes issues matching keyword in title", () => {
    const result = applyPreFilter(
      makeIssue({ title: "Fix Android native crash" }),
      { keywords_exclude: ["Android"] }
    );
    expect(result).toBe(false);
  });

  it("excludes issues matching keyword in body", () => {
    const result = applyPreFilter(
      makeIssue({ body: "This only affects iOS native" }),
      { keywords_exclude: ["iOS native"] }
    );
    expect(result).toBe(false);
  });

  it("is case-insensitive", () => {
    const result = applyPreFilter(
      makeIssue({ title: "Fix android bug" }),
      { keywords_exclude: ["Android"] }
    );
    expect(result).toBe(false);
  });
});
