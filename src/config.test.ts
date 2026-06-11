import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ensureDataDir } from "./config.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/bounty-hunter-test";

describe("config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("loads a valid watchlist.yml", () => {
    const yml = `
polling_interval: 5
telegram:
  bot_token: "test-token"
  chat_id: "12345"
sources:
  repos:
    - name: Expensify/App
      labels: ["Help Wanted"]
      proposal_template: expensify
  algora:
    enabled: true
    min_bounty: 50
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    const config = loadConfig(join(TEST_DIR, "watchlist.yml"));
    expect(config.polling_interval).toBe(5);
    expect(config.sources.repos).toHaveLength(1);
    expect(config.sources.repos[0].name).toBe("Expensify/App");
    // Legacy algora blocks are stripped, not rejected (source removed; zod drops unknown keys)
    expect("algora" in config.sources).toBe(false);
    expect(config.telegram.bot_token).toBe("test-token");
  });

  it("throws on missing file", () => {
    expect(() => loadConfig(join(TEST_DIR, "nope.yml"))).toThrow();
  });

  it("throws on invalid config shape", () => {
    const yml = `
polling_interval: "not-a-number"
telegram:
  bot_token: 123
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    expect(() => loadConfig(join(TEST_DIR, "watchlist.yml"))).toThrow();
  });

  it("overrides telegram config from env vars", () => {
    const yml = `
polling_interval: 5
telegram:
  bot_token: "yaml-token"
  chat_id: "yaml-chat"
sources:
  repos: []
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    process.env.TELEGRAM_BOT_TOKEN = "env-token";
    process.env.TELEGRAM_CHAT_ID = "env-chat";
    try {
      const config = loadConfig(join(TEST_DIR, "watchlist.yml"));
      expect(config.telegram.bot_token).toBe("env-token");
      expect(config.telegram.chat_id).toBe("env-chat");
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });
});

describe("filters defaults", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("fills in default filters when filters section is omitted", () => {
    const yml = `
polling_interval: 5
telegram:
  bot_token: "test-token"
  chat_id: "12345"
sources:
  repos: []
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    const config = loadConfig(join(TEST_DIR, "watchlist.yml"));
    expect(config.filters).toBeDefined();
    expect(config.filters.max_age_days).toBe(7);
    expect(config.filters.skip_assigned).toBe(true);
    expect(config.filters.max_comment_count).toBe(5);
    expect(config.filters.claimed_labels).toContain("Reviewing");
  });

  it("allows partial override of filters", () => {
    const yml = `
polling_interval: 5
telegram:
  bot_token: "test-token"
  chat_id: "12345"
filters:
  max_age_days: 14
  skip_assigned: false
sources:
  repos: []
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    const config = loadConfig(join(TEST_DIR, "watchlist.yml"));
    expect(config.filters.max_age_days).toBe(14);
    expect(config.filters.skip_assigned).toBe(false);
    // Defaults still apply for unspecified fields
    expect(config.filters.max_comment_count).toBe(5);
    expect(config.filters.claimed_labels).toContain("Reviewing");
  });
});

describe("vetting config defaults", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("fills in default vetting config when vetting section is omitted", () => {
    const yml = `
polling_interval: 5
telegram:
  bot_token: "test-token"
  chat_id: "12345"
sources:
  repos: []
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    const config = loadConfig(join(TEST_DIR, "watchlist.yml"));
    expect(config.vetting).toBeDefined();
    expect(config.vetting.enabled).toBe(true);
    expect(config.vetting.on_fail).toBe("skip");
    expect(config.vetting.max_proposals).toBe(3);
    expect(config.vetting.access_keywords).toContain("staging server");
    expect(config.vetting.proposal_patterns).toContain("## Proposal");
  });

  it("allows partial override of vetting config", () => {
    const yml = `
polling_interval: 5
telegram:
  bot_token: "test-token"
  chat_id: "12345"
vetting:
  on_fail: "warn"
  max_proposals: 5
sources:
  repos: []
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    const config = loadConfig(join(TEST_DIR, "watchlist.yml"));
    expect(config.vetting.on_fail).toBe("warn");
    expect(config.vetting.max_proposals).toBe(5);
    // Defaults still apply for unspecified fields
    expect(config.vetting.enabled).toBe(true);
    expect(config.vetting.access_keywords).toContain("staging server");
  });

  it("validates on_fail enum values", () => {
    const yml = `
polling_interval: 5
telegram:
  bot_token: "test-token"
  chat_id: "12345"
vetting:
  on_fail: "invalid_value"
sources:
  repos: []
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    expect(() => loadConfig(join(TEST_DIR, "watchlist.yml"))).toThrow();
  });
});

describe("ensureDataDir", () => {
  it("creates the data directory structure", () => {
    ensureDataDir(TEST_DIR);
    expect(existsSync(join(TEST_DIR, "proposals"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "clones"))).toBe(true);
  });
});
