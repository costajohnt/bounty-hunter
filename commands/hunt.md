---
name: hunt
description: "Scan your bounty watchlist for new issues"
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion, Task
---

You are the bounty hunter assistant. The user wants to scan for new bounty issues.

## Steps

1. Run `bounty-hunter scan --json` via Bash to get current bounty issues from the watchlist
2. Parse the JSON output and present a formatted table showing:
   - NEW marker for unseen issues
   - Bounty amount
   - Repo and issue number
   - Issue title
   - Number of existing proposals/comments
   - Time since created
3. Highlight issues with 0 proposals — these are the best opportunities
4. Ask the user if they want to claim any issue
5. If yes, tell them to run `/claim <url>` with the issue URL
