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

Claude Code plugin that monitors GitHub repos, GitHub Global Search, and Boss.dev for open bounty issues, sends Telegram notifications, and provides an AI-assisted `/claim` workflow to investigate codebases and draft proposals.

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
- **macOS launchd** for background scheduling

## Project Setup

```bash
npm install
npm run build    # Compile TypeScript to dist/
npx vitest run   # Run all tests (140+ tests across 9 files)
```

## Architecture

```
src/
  types.ts               Shared interfaces (BountyIssue, WatchlistConfig, SeenIssue, etc.)
  config.ts              YAML config loader, data dir management (~/.bounty-hunter/)
  seen.ts                SeenStore — JSON-backed deduplication (seen.json)
  github.ts              GitHub issue fetcher + comment fetcher (wraps gh CLI via execFileSync)
  github-search.ts       GitHub Global Search — search all of GitHub for bounty-labeled issues
  boss.ts                  Boss.dev API client (public API, USD amounts)
  telegram.ts            Telegram Bot API client (send messages, get updates, vet-enriched notifications)
  vet.ts                 Issue vetting — rule-based checks (access, competition, bounty, platform)
  monitor.ts             Background polling loop + pre-filter + vetting integration
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
- **SeenStore uses composite IDs**: `repo#number` format (e.g., `Expensify/App#81500`)

## Security Rules

- **Always use `execFileSync`/`execFile`** with array arguments — never `execSync`/`exec`
- **Never interpolate user input** into shell commands
- **Escape XML content** in plist generation (`escapeXml` function in install-launchd.ts)
- **No secrets in source** — credentials load from runtime config only

## Core Types (src/types.ts)

- `BountyIssue` — normalized issue from GitHub, GitHub Global Search, or Boss.dev (source: "github" | "github_search" | "boss")
- `WatchlistConfig` — top-level config shape (polling_interval, telegram, sources, filters, vetting)
- `RepoSource` — individual GitHub repo config (name, labels, proposal_template, pre_filter)
- `GitHubSearchSource` — GitHub Global Search config (enabled, labels, languages, min_stars, keywords_exclude, max_results)
- `BossSource` — Boss.dev config (enabled, min_bounty)
- `SeenIssue` — deduplication record (id, repo, number, title, seen_at, skipped)
- `TelegramConfig` — bot_token + chat_id
- `VettingConfig` — vetting rules (enabled, on_fail, max_proposals, access_keywords, platform_keywords, etc.)
- `IssueComment` — GitHub comment (author, authorAssociation, body, createdAt, url)
- `VetSignal` — individual vetting check result (name, passed, detail)
- `VetResult` — aggregate vetting result (passed, signals, proposal_count, summary)

## Data Flow

1. `config.ts` loads `~/.bounty-hunter/watchlist.yml` → `WatchlistConfig`
2. `monitor.ts` iterates repos: `fetchRepoIssues()` → `applyPreFilter()` → `applyFreshnessFilter()` → `seen.markSeenFromBounty()`
3. `monitor.ts` vets survivors: `fetchIssueComments()` → `vetIssue()` → `shouldNotify()`
4. `monitor.ts` polls GitHub Global Search: `fetchGlobalBounties()` → dedup watched repos → `applyFreshnessFilter()` → `fetchIssueComments()` → `vetIssue()` → `shouldNotify()`
5. `monitor.ts` polls Boss.dev: `fetchBossBounties(buildBossFilters())` → `fetchIssueMetadata()` (enrich) → freshness → `fetchIssueComments()` → `vetIssue()`
6. `index.ts` scan uses in-memory `Set<string>` for cross-source dedup within a single run
7. New issues → `formatBountyNotification(issue, vetResult?)` → `sendTelegramMessage()`

## Testing

- Tests live alongside source as `*.test.ts`
- 174+ tests across 10 files
- Integration test (`integration.test.ts`) hits real GitHub API via `gh` — requires `gh auth status`
- Integration test overrides `HOME` to isolate config; preserves `GH_CONFIG_DIR` for auth
- Run: `npx vitest run` (all tests) or `npx vitest run src/github.test.ts` (single file)

## CLI Commands

- `bounty-hunter scan [--json]` — poll watchlist, return issues
- `bounty-hunter notify <issue-json>` — send Telegram notification
- `bounty-hunter post-comment --repo <repo> --issue <num> --body <file>` — post proposal
- `bounty-hunter seen --add <repo>#<number>` — mark issue as seen
- `bounty-hunter config` — output current watchlist config as JSON
