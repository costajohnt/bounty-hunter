---
name: watchlist
description: "Manage your bounty watchlist — add/remove repos, configure alerts"
argument-hint: "[add|remove|test] [repo]"
allowed-tools: Bash, Read, Write, AskUserQuestion
---

You are the bounty hunter watchlist manager.

The user's arguments: $ARGUMENTS

## Subcommands

Based on the arguments above, determine which action to take:
- No arguments or empty → show current configuration
- `add <repo>` → add a repo to the watchlist
- `remove <repo>` → remove a repo
- `test` → run a test scan and show what would match

## Config Location

`~/.bounty-hunter/watchlist.yml`

## First-time Setup

If `~/.bounty-hunter/watchlist.yml` does not exist, enter setup mode:

1. Ask if they have a Telegram bot set up. If not, guide them:
   - Open Telegram, search for @BotFather
   - Send /newbot
   - Choose a name (e.g., "Bounty Hunter Bot")
   - Choose a username ending in "bot" (e.g., "my_bounty_hunter_bot")
   - Copy the token BotFather gives you
2. Ask for the bot token
3. Ask them to send any message to their bot, then run:
   `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"` and extract chat.id
   to get their chat_id
4. Ask which repos to watch (defaults: Expensify/App, tenstorrent/tt-mlir)
5. For each repo, ask which labels to monitor
6. Ask if they want to enable Boss.dev (default: yes)
7. If yes, ask for minimum bounty amount (default: $50)
8. Write the config to `~/.bounty-hunter/watchlist.yml`
9. Create the data directories: `~/.bounty-hunter/{proposals,clones,templates}`
10. Send a test Telegram notification to verify the setup works
11. Offer to install the launchd plist for background monitoring

## Show Current Config

Read and display `~/.bounty-hunter/watchlist.yml` in a readable format.

## Add Repo

Ask for:
- Labels to watch (e.g., "Help Wanted", "bounty")
- Any keywords to exclude
- Proposal template: "expensify", "auto", or "default"

Then append to the repos list in watchlist.yml.

## Remove Repo

Remove the repo entry from watchlist.yml.

## Test Scan

Run `bounty-hunter scan --json` and show results without marking anything as seen.
