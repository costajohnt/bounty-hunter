# Contributing to Bounty Hunter

## Getting Started

```bash
git clone https://github.com/costajohnt/bounty-hunter.git
cd bounty-hunter
npm install
npm run build
npx vitest run
```

You need Node.js 20+ and the GitHub CLI (`gh`) authenticated for integration tests.

## Development Workflow

1. Always branch off `main`:
   ```bash
   git checkout main && git pull origin main
   git checkout -b your-branch-name
   ```
2. Write tests before implementation. Every new exported function needs a test.
3. Build and run the full test suite before pushing:
   ```bash
   npm run build && npx vitest run
   ```
4. Open a PR against `main`. Never commit directly to `main`.

### Commit Conventions

Use clear, imperative commit messages:

```
add algora API pagination support
fix telegram notification escaping
refactor config loader to use yaml.parse
```

No prefix tags, no capitalized first word, no trailing period.

## Code Style

This is a **TypeScript ESM** project (`"type": "module"` in package.json).

- All imports **must** use `.js` extensions:
  ```typescript
  import { loadConfig } from "./config.js";
  ```
- Target is ES2022 with strict mode enabled.
- Use `execFileSync` (or `execFile`) with array arguments for all subprocess calls. Never use `execSync` or `exec`.
- Keep modules focused. Each source file in `src/` covers a single concern (GitHub client, Algora client, Telegram client, config, monitor, etc.).

## Testing

Tests use **vitest** and live alongside source files as `*.test.ts`.

```bash
# Run all tests
npx vitest run

# Run a specific test file
npx vitest run src/github.test.ts

# Watch mode during development
npx vitest
```

**What needs tests:**

- Any new exported function.
- Any bug fix (add a regression test).
- Any change to CLI output format.

**Integration tests** (`src/integration.test.ts`) hit the real GitHub API and require `gh auth status` to pass. These run as part of the normal test suite. If you do not have `gh` authenticated, they will fail.

## Security

These rules are non-negotiable:

1. **Never use `exec` or `execSync`.** Always use `execFileSync` (or `execFile`) with arguments as an array:
   ```typescript
   // correct
   execFileSync("gh", ["issue", "list", "--repo", repo, "--json", "title"]);

   // wrong -- shell injection risk
   execSync(`gh issue list --repo ${repo} --json title`);
   ```
2. **Never interpolate user input into commands.** Pass user-provided values as discrete array elements.
3. **Escape XML/plist content.** When generating launchd plist files, escape all dynamic values (`&`, `<`, `>`, `"`, `'`) to prevent XML injection.

## Pull Requests

- **Branch naming:** descriptive kebab-case (`add-algora-pagination`, `fix-telegram-escaping`).
- **PR description:** explain what changed and why. Include test output if relevant.
- **Tests must pass.** PRs with failing tests will not be reviewed.
- **Squash merge preferred.** Keep `main` history clean.
- The maintainer reviews and merges all PRs. Do not merge your own.

## Project Architecture

```
src/                 TypeScript CLI source
  index.ts           CLI entry point
  github.ts          GitHub API client (uses gh CLI)
  algora.ts          Algora bounty API client
  telegram.ts        Telegram notification client
  config.ts          Watchlist config loader (~/.bounty-hunter/watchlist.yml)
  monitor.ts         Background polling logic (no AI, just API calls)
  seen.ts            Tracks seen issues (~/.bounty-hunter/seen.json)
  install-launchd.ts macOS launchd plist generator
  types.ts           Shared type definitions

commands/            Claude Code slash commands
  hunt.md            /hunt -- scan for new bounty issues
  claim.md           /claim -- investigate and draft a proposal
  watchlist.md       /watchlist -- manage watched repos

agents/              Claude Code subagents
  issue-investigator.md   Analyzes an issue and drafts a proposal

templates/           Per-repo proposal templates
  default.md         Generic proposal format
  expensify.md       Expensify-specific proposal format
```

The CLI outputs JSON via `--json` for slash commands and agents to consume. State is stored in `~/.bounty-hunter/`. The background monitor is a standalone Node script run by launchd -- it does no AI work, only API polling and Telegram notifications. AI runs only when a user triggers `/claim` interactively.
