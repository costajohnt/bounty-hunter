import type { BountyIssue, BossSource } from "./types.js";

const BOSS_API = "https://api.boss.dev/rpc/issues/gh/unsolved";

interface BossItem {
  hId: string;
  title: string;
  url: string;
  usd: number;
  status: string;
  sByC: Record<string, number>;
}

/**
 * Parses the hId field ("owner/repo#number") into repo and issue number.
 */
export function parseHId(hId: string): { repo: string; number: number } | null {
  const match = hId.match(/^(.+?)#(\d+)$/);
  if (!match) return null;
  return { repo: match[1], number: parseInt(match[2], 10) };
}

/**
 * Parses raw Boss.dev API response into BountyIssue array.
 */
export function parseBossResponse(
  items: BossItem[],
  filters?: { min_bounty?: number }
): BountyIssue[] {
  return items
    .filter((item) => {
      if (item.status !== "open") return false;
      if (filters?.min_bounty && item.usd < filters.min_bounty) return false;
      return true;
    })
    .map((item) => {
      const parsed = parseHId(item.hId);
      return {
        source: "boss" as const,
        repo: parsed?.repo ?? "",
        number: parsed?.number ?? 0,
        title: item.title,
        url: item.url,
        bounty_amount: item.usd,
        bounty_formatted: `$${item.usd.toLocaleString("en-US")}`,
        labels: [],
        assignees: [],
        body: "",
        comment_count: 0,
        created_at: "",
      };
    })
    .filter((issue) => issue.repo !== "" && issue.number !== 0);
}

/**
 * Fetches all open bounties from Boss.dev.
 */
export async function fetchBossBounties(
  filters?: { min_bounty?: number }
): Promise<BountyIssue[]> {
  const response = await fetch(BOSS_API);
  if (!response.ok) throw new Error(`Boss.dev API error: ${response.status}`);
  const data = (await response.json()) as BossItem[];
  if (!Array.isArray(data)) {
    throw new Error("Boss.dev API returned unexpected response format");
  }
  return parseBossResponse(data, filters);
}

/**
 * Converts BossSource config to filter params.
 */
export function buildBossFilters(boss: BossSource): { min_bounty?: number } {
  return {
    min_bounty: boss.min_bounty || undefined,
  };
}
