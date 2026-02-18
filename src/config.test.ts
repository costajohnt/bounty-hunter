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
    languages: []
    keywords_exclude: []
`;
    writeFileSync(join(TEST_DIR, "watchlist.yml"), yml);
    const config = loadConfig(join(TEST_DIR, "watchlist.yml"));
    expect(config.polling_interval).toBe(5);
    expect(config.sources.repos).toHaveLength(1);
    expect(config.sources.repos[0].name).toBe("Expensify/App");
    expect(config.sources.algora.enabled).toBe(true);
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
  algora:
    enabled: false
    min_bounty: 0
    languages: []
    keywords_exclude: []
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

describe("ensureDataDir", () => {
  it("creates the data directory structure", () => {
    ensureDataDir(TEST_DIR);
    expect(existsSync(join(TEST_DIR, "proposals"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "clones"))).toBe(true);
  });
});
