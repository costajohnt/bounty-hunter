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

## Project Setup

- **TypeScript ESM** project (`"type": "module"` in package.json)
- All imports **must** use `.js` extensions (e.g., `import { foo } from "./bar.js"`)
- **vitest** for testing: `npx vitest run`
- **Build:** `npm run build` (compiles to `dist/`)

## Security

- Use `execFileSync`/`execFile` instead of `execSync`/`exec` to prevent shell injection
- Never interpolate user input into shell commands
- Use array-based arguments for all subprocess calls

## Architecture

- `src/` — TypeScript CLI source (GitHub, Algora, Telegram API clients, config parser)
- `commands/` — Claude Code slash commands (`/hunt`, `/claim`, `/watchlist`)
- `agents/` — Specialized subagents (issue-investigator)
- `templates/` — Per-repo proposal templates (Expensify format, default)

## Key Patterns

- CLI outputs JSON via `--json` flag for commands/agents to consume
- State stored in `~/.bounty-hunter/` (watchlist.yml, seen.json, proposals/, clones/)
- Background monitor is a standalone Node script run by launchd — no AI, just API polling
- AI only runs interactively when user triggers `/claim`

## CLI Commands

- `bounty-hunter scan [--json]` — poll watchlist, return issues
- `bounty-hunter notify <issue-json>` — send Telegram notification
- `bounty-hunter post-comment --repo <repo> --issue <num> --body <file>` — post proposal to GitHub
- `bounty-hunter seen --add <repo>#<number>` — mark issue as seen
- `bounty-hunter config` — output current watchlist config as JSON
