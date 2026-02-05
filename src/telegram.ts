import type { BountyIssue, TelegramConfig } from "./types.js";

const API_BASE = "https://api.telegram.org/bot";

export function formatBountyNotification(issue: BountyIssue): string {
  const source = issue.source === "algora" ? " (Algora)" : "";
  const bounty = issue.bounty_formatted ? ` — ${issue.bounty_formatted}` : "";
  const labels = issue.labels.length ? `\nLabels: ${issue.labels.join(", ")}` : "";
  const tech = issue.tech?.length ? `\nTech: ${issue.tech.join(", ")}` : "";
  const proposals = `\nProposals: ${issue.comment_count}`;

  return [
    `🎯 ${issue.repo} #${issue.number}${bounty}${source}`,
    `"${issue.title}"`,
    `${labels}${tech}${proposals}`,
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
