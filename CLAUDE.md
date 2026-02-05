# Bounty Hunter Plugin

## Git Workflow (MUST FOLLOW)

1. **Before any work:** Check out `main` and pull to ensure you have the latest code
   ```
   git checkout main && git pull origin main
   ```
2. **Cut a branch** off `main` for each piece of work — never commit directly to `main`
3. **Work on the feature branch only** — do not touch `main`
4. **Do not commit** unless you have explicit permission from the developer
5. **Always create a PR** against `main` when work is ready for review
6. **The developer manually reviews and merges** all PRs — never merge yourself

## Project Overview

Claude Code plugin that monitors GitHub repos and Algora for open bounty issues, sends Telegram notifications, and provides an AI-assisted `/claim` workflow to investigate codebases and draft proposals.

Two modes of operation:
- **Background monitor** (no AI): standalone Node.js script run by launchd, polls APIs on a timer
- **Interactive claiming** (AI-assisted): `/claim <url>` fetches issue, clones repo, runs investigation agent, drafts proposal

## Tech Stack

- **TypeScript ESM** (`"type": "module"`, target ES2022, strict mode)
- **Node.js 20+** runtime
- **vitest** for testing
- **yaml** package for config parsing (only runtime dependency)
- **GitHub CLI (`gh`)** for GitHub API access (no token management needed)
- **Telegram Bot API** for notifications
- **Algora tRPC API** for bounty discovery (public, no auth)
- **macOS launchd** for background scheduling

## Project Setup

```bash
npm install
npm run build    # Compile TypeScript to dist/
npx vitest run   # Run all tests (32 tests across 8 files)
```

## Architecture

```
src/
  types.ts               Shared interfaces (BountyIssue, WatchlistConfig, SeenIssue, etc.)
  config.ts              YAML config loader, data dir management (~/.bounty-hunter/)
  seen.ts                SeenStore — JSON-backed deduplication (seen.json)
  github.ts              GitHub issue fetcher (wraps gh CLI via execFileSync)
  algora.ts              Algora tRPC client (public API, amounts in cents)
  telegram.ts            Telegram Bot API client (send messages, get updates)
  monitor.ts             Background polling loop + pre-filter logic
  index.ts               CLI entry point (scan, notify, post-comment, seen, config)
  install-launchd.ts     macOS launchd plist generator and installer

commands/                Claude Code slash commands
  hunt.md                /hunt — scan for bounties
  claim.md               /claim <url> — investigate + draft proposal
  watchlist.md           /watchlist — manage config, first-time setup

agents/
  issue-investigator.md  Codebase exploration agent (grep, read, trace)

templates/
  expensify.md           Expensify proposal format (4 required sections, no code diffs)
  default.md             Generic proposal format
```

## Key Patterns

- **CLI outputs JSON** via `--json` flag for commands/agents to consume
- **State stored in** `~/.bounty-hunter/` (watchlist.yml, seen.json, proposals/, clones/)
- **Background monitor is standalone** — no AI, just API polling + Telegram notifications
- **AI only runs interactively** when user triggers `/claim`
- **All imports use `.js` extensions** (ESM requirement): `import { foo } from "./bar.js"`
- **ESM entry point guard**: `fileURLToPath(import.meta.url) === resolve(process.argv[1])`
- **Algora amounts are in cents** — divide by 100 for display/filtering
- **SeenStore uses composite IDs**: `repo#number` format (e.g., `Expensify/App#81500`)

## Security Rules

- **Always use `execFileSync`/`execFile`** with array arguments — never `execSync`/`exec`
- **Never interpolate user input** into shell commands
- **Escape XML content** in plist generation (`escapeXml` function in install-launchd.ts)
- **No secrets in source** — credentials load from runtime config only

## Core Types (src/types.ts)

- `BountyIssue` — normalized issue from GitHub or Algora (source, repo, number, title, url, bounty_amount, labels, body)
- `WatchlistConfig` — top-level config shape (polling_interval, telegram, sources)
- `RepoSource` — individual GitHub repo config (name, labels, proposal_template, pre_filter)
- `AlgoraSource` — Algora config (enabled, min_bounty, languages, keywords_exclude)
- `SeenIssue` — deduplication record (id, repo, number, title, seen_at, skipped)
- `TelegramConfig` — bot_token + chat_id

## Data Flow

1. `config.ts` loads `~/.bounty-hunter/watchlist.yml` → `WatchlistConfig`
2. `monitor.ts` iterates repos: `fetchRepoIssues()` → `applyPreFilter()` → `seen.hasSeen()` → `seen.markSeenFromBounty()`
3. `monitor.ts` polls Algora: `fetchAlgoraBounties(buildAlgoraFilters())` → `seen.hasSeen()` → `seen.markSeenFromBounty()`
4. New issues → `formatBountyNotification()` → `sendTelegramMessage()`

## Testing

- Tests live alongside source as `*.test.ts`
- 32 tests across 8 files
- Integration test (`integration.test.ts`) hits real GitHub API via `gh` — requires `gh auth status`
- Integration test overrides `HOME` to isolate config; preserves `GH_CONFIG_DIR` for auth
- Run: `npx vitest run` (all tests) or `npx vitest run src/github.test.ts` (single file)

## CLI Commands

- `bounty-hunter scan [--json]` — poll watchlist, return issues
- `bounty-hunter notify <issue-json>` — send Telegram notification
- `bounty-hunter post-comment --repo <repo> --issue <num> --body <file>` — post proposal
- `bounty-hunter seen --add <repo>#<number>` — mark issue as seen
- `bounty-hunter config` — output current watchlist config as JSON
