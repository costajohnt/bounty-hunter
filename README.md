# Bounty Hunter

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that monitors GitHub repos and [Algora](https://algora.io) for open bounty issues, sends Telegram push notifications when new bounties appear, and provides an interactive `/claim` workflow to investigate codebases and draft proposals with AI assistance.

## Table of Contents

- [Quick Start](#quick-start)
- [Why Bounty Hunter?](#why-bounty-hunter)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Plugin Commands](#plugin-commands)
  - [CLI Commands](#cli-commands)
- [Background Monitor](#background-monitor)
- [Proposal Templates](#proposal-templates)
- [Architecture](#architecture)
- [Development](#development)
- [License](#license)

## Quick Start

From zero to Telegram pings in 5 steps.

**1. Clone and build**

```bash
git clone https://github.com/costajohnt/bounty-hunter.git
cd bounty-hunter
npm install
npm run build
```

**2. Create a Telegram bot**

Open Telegram, search for [@BotFather](https://t.me/BotFather), and send `/newbot`. Pick a name and username. BotFather replies with a **bot token** — copy it.

**3. Get your chat ID**

Send any message to your new bot in Telegram, then run:

```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
```

**4. Write the config**

```bash
mkdir -p ~/.bounty-hunter
cat > ~/.bounty-hunter/watchlist.yml << 'EOF'
polling_interval: 5

telegram:
  bot_token: "YOUR_BOT_TOKEN"
  chat_id: "YOUR_CHAT_ID"

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
EOF
```

Edit the file to add your bot token, chat ID, and the repos you want to watch. See [Configuration](#configuration) for all available options.

**5. Start the background monitor**

```bash
# Test it once to make sure it works
node dist/monitor.js

# Install the launchd agent to run every 5 minutes
node dist/install-launchd.js install
```

You'll get a Telegram message whenever a new bounty appears. To claim one, open Claude Code with the plugin loaded and use `/claim`:

```bash
claude --plugin-dir /path/to/bounty-hunter
```

```
/claim https://github.com/Expensify/App/issues/81500
```

---

## Why Bounty Hunter?

Open-source bounty issues are competitive. The first adequate proposal often wins. The two biggest bottlenecks for contributors are:

1. **Time to awareness** -- By the time you manually check a repo, scroll through labels, and find a new bounty, someone else has already claimed it. Hours or even minutes matter.

2. **Time to investigation** -- Understanding an unfamiliar codebase well enough to write a credible proposal takes time. Cloning, grepping, tracing execution paths, reading contributing guidelines -- it adds up.

Bounty Hunter attacks both bottlenecks. A lightweight background monitor polls your watchlist and sends Telegram notifications the moment a new bounty appears -- no AI, no heavy compute, just API calls on a timer. When you are ready to act, the `/claim` command clones the repo, launches an AI-powered investigation agent to explore the code, and drafts a proposal in the format the project expects. You review, edit if needed, and post -- all without leaving Claude Code.

## How It Works

The plugin operates in two distinct modes:

**Background monitoring (no AI):** A standalone Node.js script runs on a timer via macOS launchd. It polls GitHub (via `gh` CLI) and the Algora tRPC API for issues matching your watchlist criteria, deduplicates against previously seen issues, and sends Telegram notifications for anything new.

**Interactive claiming (AI-assisted):** When you run `/claim <issue-url>` inside Claude Code, the plugin fetches the full issue, assesses competition from existing proposals, clones or updates the repository, launches an investigation agent to explore the codebase, drafts a proposal using the appropriate template, and presents it for your review before posting.

```
  Telegram notification arrives
         |
         v
  You open Claude Code
         |
         v
  /claim https://github.com/org/repo/issues/123
         |
         v
  Fetch issue --> Assess competition --> Clone repo
         |
         v
  AI investigates codebase (grep, read, trace)
         |
         v
  Draft proposal using repo's template
         |
         v
  Review --> Approve / Edit / Save / Discard
         |
         v
  Post comment on GitHub issue
```

## Prerequisites

- **Node.js 20+**
- **GitHub CLI** (`gh`) -- [install](https://cli.github.com/) and authenticate with `gh auth login`
- **Claude Code CLI** -- [install](https://docs.anthropic.com/en/docs/claude-code)
- **Telegram bot** -- created via [@BotFather](https://t.me/BotFather) (takes about 60 seconds)

## Installation

Clone the repository and build:

```bash
git clone https://github.com/costajohnt/bounty-hunter.git
cd bounty-hunter
npm install
npm run build
```

Launch Claude Code with the plugin loaded:

```bash
claude --plugin-dir /path/to/bounty-hunter
```

Then run `/watchlist` to start the interactive setup wizard.

## Configuration

All state is stored in `~/.bounty-hunter/`:

```
~/.bounty-hunter/
  watchlist.yml     # Your configuration (repos, labels, Telegram, Algora)
  seen.json         # Deduplication store for already-seen issues
  proposals/        # Saved proposal drafts
  clones/           # Shallow repo clones (cached)
```

### Watchlist Format

The watchlist lives at `~/.bounty-hunter/watchlist.yml`. You can edit it by hand or use the `/watchlist` command inside Claude Code.

```yaml
polling_interval: 5  # minutes

telegram:
  bot_token: "123456:ABC-DEF..."
  chat_id: "987654321"

sources:
  repos:
    - name: Expensify/App
      labels: ["Help Wanted"]
      proposal_template: expensify
      pre_filter:
        keywords_exclude: ["Android", "iOS native"]

    - name: tenstorrent/tt-mlir
      labels: ["bounty"]
      proposal_template: auto

  algora:
    enabled: true
    min_bounty: 50        # USD, filters out small bounties
    languages: []          # empty = all languages
    keywords_exclude: []   # exclude issues containing these terms
```

### Configuration Fields

| Field | Description |
|---|---|
| `polling_interval` | How often the background monitor checks for new issues, in minutes |
| `telegram.bot_token` | Token from @BotFather |
| `telegram.chat_id` | Your Telegram chat ID (the setup wizard helps you find this) |
| `sources.repos[].name` | GitHub repo in `owner/repo` format |
| `sources.repos[].labels` | Only match issues with these labels |
| `sources.repos[].proposal_template` | Which template to use: `expensify`, `default`, or `auto` |
| `sources.repos[].pre_filter.keywords_exclude` | Skip issues whose title or body contains these keywords |
| `sources.algora.enabled` | Whether to poll Algora for bounties |
| `sources.algora.min_bounty` | Minimum bounty amount in USD (Algora amounts are in cents internally) |
| `sources.algora.languages` | Only match bounties tagged with these languages (empty = all) |
| `sources.algora.keywords_exclude` | Skip Algora bounties containing these keywords |

### Telegram Setup

If you do not have a Telegram bot yet, the `/watchlist` command walks you through it. The short version:

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`, choose a name and username
3. Copy the bot token BotFather gives you
4. Send any message to your new bot
5. Run `curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"` and find your `chat.id` in the response

## Usage

### Plugin Commands

These are the slash commands available inside Claude Code after installing the plugin:

#### /hunt -- Scan for Bounties

Scans your entire watchlist and displays a formatted table of bounty issues. New (unseen) issues are highlighted. Issues with zero existing proposals are called out as the best opportunities.

```
/hunt
```

#### /claim -- Investigate and Draft a Proposal

The core workflow. Give it a GitHub issue URL and it handles the rest:

```
/claim https://github.com/Expensify/App/issues/81500
```

What happens:

1. Fetches the issue body, comments, and labels via `gh`
2. Assesses competition (counts existing proposals, summarizes them)
3. Clones or updates the repo (shallow clone, cached in `~/.bounty-hunter/clones/`)
4. Launches the issue-investigator agent to explore the codebase -- reads files mentioned in the issue, searches for relevant code, traces execution paths, identifies root cause or implementation location
5. Drafts a proposal using the appropriate template for the repo
6. Presents the draft for your review with four options:
   - **Approve** -- posts the proposal as a GitHub comment
   - **Edit** -- modify the text, then re-review
   - **Save for later** -- writes to `~/.bounty-hunter/proposals/` without posting
   - **Discard** -- skip this issue

#### /watchlist -- Manage Configuration

View, modify, or test your watchlist configuration:

```
/watchlist              # Show current configuration
/watchlist add <repo>   # Add a repo to the watchlist
/watchlist remove <repo># Remove a repo
/watchlist test         # Run a test scan without marking anything as seen
```

On first run (when no config file exists), `/watchlist` enters an interactive setup wizard that walks you through Telegram bot creation, repo selection, label configuration, and Algora settings.

### CLI Commands

The CLI is used internally by the plugin commands but can also be invoked directly for scripting or debugging:

```bash
# Scan the watchlist and display results
bounty-hunter scan
bounty-hunter scan --json

# Send a Telegram notification for an issue
bounty-hunter notify '<issue-json>'

# Post a proposal as a GitHub comment
bounty-hunter post-comment --repo owner/repo --issue 123 --body proposal.md

# Mark an issue as seen (skip future notifications)
bounty-hunter seen --add owner/repo#123

# Output current watchlist config as JSON
bounty-hunter config
```

## Background Monitor

The background monitor is a standalone Node.js script that runs without AI. It polls GitHub and Algora on a timer, checks for new issues against the seen store, and sends Telegram notifications for anything new.

On macOS, it runs as a launchd agent that fires every N minutes (matching your `polling_interval` setting).

### Install the Monitor

```bash
node dist/install-launchd.js install
```

This creates a launchd plist at `~/Library/LaunchAgents/com.bounty-hunter.monitor.plist`, loads it immediately, and starts polling. The monitor runs at login and on the configured interval.

### Uninstall the Monitor

```bash
node dist/install-launchd.js uninstall
```

### Logs

Monitor output is written to:

```
~/.bounty-hunter/monitor.log
```

### How It Differs from /hunt

The background monitor and `/hunt` serve different purposes:

| | Background Monitor | /hunt |
|---|---|---|
| Runs | Automatically on a timer | On demand, inside Claude Code |
| AI | None | None (but leads into `/claim`) |
| Output | Telegram push notifications | Formatted table in Claude Code |
| Marks seen | Yes (prevents duplicate notifications) | No (read-only view) |

## Proposal Templates

Bounty Hunter ships with two built-in proposal templates and an `auto` mode:

### expensify

Follows Expensify's strict proposal format with four required sections. Does **not** include code diffs (Expensify forbids them in proposals).

```markdown
### Please re-state the problem that we are trying to solve in this issue.
### What is the root cause of that problem?
### What changes do you think we should make in order to solve the problem?
### What alternative solutions did you explore? (Optional)
```

### default

A generic format suitable for most projects:

```markdown
**Problem:** ...
**Root Cause:** ...
**Proposed Changes:** ...
**Testing:** ...
```

### auto

When set to `auto`, the `/claim` command checks the target repo's `CONTRIBUTING.md` for proposal format guidance and adapts accordingly.

### Custom Templates

You can add your own templates by placing Markdown files in the `templates/` directory of the plugin. Reference them by filename (without extension) in your watchlist config.

## Architecture

```
bounty-hunter/
├── .claude-plugin/
│   └── plugin.json            # Plugin manifest (name, description, metadata)
├── src/
│   ├── types.ts               # Core interfaces (BountyIssue, WatchlistConfig, etc.)
│   ├── config.ts              # YAML config loader, data directory management
│   ├── seen.ts                # SeenStore — JSON-backed deduplication
│   ├── github.ts              # GitHub issue fetcher (wraps gh CLI via execFileSync)
│   ├── algora.ts              # Algora tRPC client (public API, no auth needed)
│   ├── telegram.ts            # Telegram Bot API (send messages, get updates)
│   ├── monitor.ts             # Background polling loop + pre-filter logic
│   ├── index.ts               # CLI entry point (scan, notify, post-comment, seen, config)
│   └── install-launchd.ts     # macOS launchd plist generator and installer
├── commands/
│   ├── hunt.md                # /hunt — scan for bounties
│   ├── claim.md               # /claim <url> — investigate + draft proposal
│   └── watchlist.md           # /watchlist — manage config, first-time setup
├── agents/
│   └── issue-investigator.md  # Codebase exploration agent (grep, read, trace)
└── templates/
    ├── expensify.md           # Expensify proposal format
    └── default.md             # Generic proposal format
```

### Design Decisions

- **`gh` CLI over GitHub API:** Uses the GitHub CLI instead of direct API calls. This avoids token management entirely -- if `gh` is authenticated, everything works.
- **`execFileSync` over `execSync`:** All subprocess calls use `execFileSync` with array arguments to prevent shell injection.
- **No AI in the monitor:** The background process does zero AI inference. It is pure API polling and notification logic. This keeps it fast, cheap, and predictable.
- **Shallow clones:** Repos are cloned with `--depth 50` and cached in `~/.bounty-hunter/clones/`. Subsequent runs fetch and checkout rather than re-cloning.
- **Algora amounts in cents:** The Algora API returns bounty amounts in cents. The plugin converts to dollars for display and filtering.

## Development

### Setup

```bash
git clone https://github.com/costajohnt/bounty-hunter.git
cd bounty-hunter
npm install
```

### Build

```bash
npm run build       # Compile TypeScript to dist/
npm run dev         # Watch mode — recompiles on file changes
```

### Test

The test suite includes 22 tests across 7 test files covering config loading, seen store persistence, pre-filter logic, GitHub argument building, Algora response parsing, Telegram formatting, and CLI integration.

```bash
npx vitest run      # Run all tests once
npx vitest          # Watch mode
```

### Project Conventions

- **TypeScript ESM** -- the project uses `"type": "module"` in package.json
- All imports must use `.js` extensions (e.g., `import { foo } from "./bar.js"`)
- `vitest` for testing
- Strict TypeScript (`"strict": true`)

### Dependencies

The project has a single runtime dependency:

| Package | Purpose |
|---|---|
| `yaml` | Parse `watchlist.yml` configuration |

Dev dependencies: `typescript`, `@types/node`, `vitest`.

## License

MIT
