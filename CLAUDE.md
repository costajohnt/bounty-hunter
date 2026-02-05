# Bounty Hunter Plugin

## Architecture
- `src/` — TypeScript CLI source (GitHub, Algora, Telegram API clients, config parser)
- `commands/` — Claude Code slash commands (/hunt, /claim, /watchlist)
- `agents/` — Specialized subagents (issue-investigator, proposal-drafter)
- `templates/` — Per-repo proposal templates

## Security
- Use execFileSync/execFile instead of execSync/exec to prevent shell injection
- Never interpolate user input into shell commands
- Use array-based arguments for all subprocess calls

## Key Patterns
- CLI outputs JSON via --json flag for commands/agents to consume
- State stored in ~/.bounty-hunter/ (watchlist.yml, seen.json, proposals/, clones/)
- Background monitor is a standalone Node script run by launchd — no AI, just API polling
- AI only runs interactively when user triggers /claim

## Commands
- `bounty-hunter scan --json` — poll watchlist, return new issues as JSON
- `bounty-hunter notify <issue-json>` — send Telegram notification
- `bounty-hunter post-comment --repo <repo> --issue <num> --body <file>` — post proposal to GitHub
- `bounty-hunter seen --add <issue-id>` — mark issue as seen
- `bounty-hunter config` — output current watchlist config as JSON
