import type { BountyIssue, TelegramConfig, VetResult } from "./types.js";

const API_BASE = "https://api.telegram.org/bot";

export function formatBountyNotification(
  issue: BountyIssue,
  vetResult?: VetResult
): string {
  const source = issue.source === "github_search" ? " (Global)" : issue.source === "boss" ? " (Boss)" : "";
  const bounty = issue.bounty_formatted ? ` — ${issue.bounty_formatted}` : "";
  const labels = issue.labels.length
    ? `\nLabels: ${issue.labels.join(", ")}`
    : "";
  const tech = issue.tech?.length ? `\nTech: ${issue.tech.join(", ")}` : "";

  // Use verified proposal count when available, fall back to raw comment count
  const proposalCount = vetResult
    ? vetResult.proposal_count
    : issue.comment_count;
  const proposals = `\nProposals: ${proposalCount}`;

  // Determine emoji prefix and vetting status line
  let prefix: string;
  let vetLine: string;

  if (vetResult) {
    if (vetResult.passed) {
      prefix = "\u2705"; // ✅
      vetLine = `\nVetted: OK`;
    } else {
      prefix = "\u26a0\ufe0f"; // ⚠️
      vetLine = `\n${vetResult.summary}`;
    }
  } else {
    prefix = "\ud83c\udfaf"; // 🎯
    vetLine = "";
  }

  return [
    `${prefix} ${issue.repo} #${issue.number}${bounty}${source}`,
    `"${issue.title}"`,
    `${labels}${tech}${proposals}${vetLine}`,
    `\n${issue.url}`,
    `\nReply "skip" to dismiss`,
  ].join("\n");
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string
): Promise<void> {
  const url = `${API_BASE}${config.bot_token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chat_id,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram API error: ${response.status} — ${err}`);
  }
}

export async function getTelegramUpdates(
  config: TelegramConfig,
  offset: number = 0
): Promise<{ update_id: number; text: string }[]> {
  const url = `${API_BASE}${config.bot_token}/getUpdates`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offset,
      limit: 100,
      timeout: 5,
      allowed_updates: ["message"],
    }),
  });
  if (!response.ok) throw new Error(`Telegram getUpdates error: ${response.status}`);
  const data = (await response.json()) as {
    result: Array<{
      update_id: number;
      message?: { text?: string };
    }>;
  };
  return data.result
    .filter((u) => u.message?.text)
    .map((u) => ({ update_id: u.update_id, text: u.message!.text! }));
}
