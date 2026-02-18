import { describe, it, expect } from "vitest";
import { parseIssueUrl, buildSearchArgs, buildIssueViewArgs } from "./github.js";

describe("parseIssueUrl", () => {
  it("parses a standard GitHub issue URL", () => {
    const result = parseIssueUrl("https://github.com/Expensify/App/issues/81500");
    expect(result).toEqual({ owner: "Expensify", repo: "App", number: 81500 });
  });

  it("parses a URL with trailing slash", () => {
    const result = parseIssueUrl("https://github.com/Expensify/App/issues/81500/");
    expect(result).toEqual({ owner: "Expensify", repo: "App", number: 81500 });
  });

  it("throws on invalid URL", () => {
    expect(() => parseIssueUrl("https://google.com")).toThrow();
  });
});

describe("buildSearchArgs", () => {
  it("builds gh search args for a repo with labels", () => {
    const args = buildSearchArgs("Expensify/App", ["Help Wanted"]);
    expect(args).toContain("search");
    expect(args).toContain("issues");
    expect(args).toContain("Expensify/App");
    expect(args).toContain("Help Wanted");
  });

  it("includes assignees in the JSON fields", () => {
    const args = buildSearchArgs("Expensify/App", ["Help Wanted"]);
    const jsonIdx = args.indexOf("--json");
    const jsonFields = args[jsonIdx + 1];
    expect(jsonFields).toContain("assignees");
  });

  it("includes all labels when multiple are provided", () => {
    const args = buildSearchArgs("Expensify/App", ["Help Wanted", "External", "Bug"]);
    expect(args).toContain("Help Wanted");
    expect(args).toContain("External");
    expect(args).toContain("Bug");
    // Each label should be preceded by --label
    const labelFlags = args.reduce((count, arg) => arg === "--label" ? count + 1 : count, 0);
    expect(labelFlags).toBe(3);
  });
});

describe("buildIssueViewArgs", () => {
  it("builds gh issue view args for fetching comments", () => {
    const args = buildIssueViewArgs("Expensify/App", 81500);
    expect(args).toContain("issue");
    expect(args).toContain("view");
    expect(args).toContain("81500");
    expect(args).toContain("Expensify/App");
    expect(args).toContain("comments");
  });

  it("uses --repo flag for the repo", () => {
    const args = buildIssueViewArgs("Expensify/App", 100);
    const repoIdx = args.indexOf("--repo");
    expect(repoIdx).toBeGreaterThan(-1);
    expect(args[repoIdx + 1]).toBe("Expensify/App");
  });

  it("passes issue number as string", () => {
    const args = buildIssueViewArgs("foo/bar", 42);
    expect(args).toContain("42");
  });
});
