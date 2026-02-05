import { describe, it, expect } from "vitest";
import { parseIssueUrl, buildSearchArgs } from "./github.js";

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
});
