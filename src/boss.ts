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
      // Type validation first — prevents coercion bugs in downstream comparisons
      if (typeof item.hId !== "string" || typeof item.usd !== "number") {
        console.warn("Boss.dev: skipping malformed item:", item.title ?? "(no title)");
        return false;
      }
      const parsed = parseHId(item.hId);
      if (!parsed) {
        console.warn(`Boss.dev: skipping item with unparseable hId: "${item.hId}"`);
        return false;
      }
      if (item.status !== "open") return false;
      if (filters?.min_bounty && filters.min_bounty > 0 && item.usd < filters.min_bounty) return false;
      return true;
    })
    .map((item) => {
      const parsed = parseHId(item.hId)!; // safe: validated in filter above
      return {
        source: "boss" as const,
        repo: parsed.repo,
        number: parsed.number,
        title: item.title ?? "(untitled)",
        url: item.url ?? "",
        bounty_amount: item.usd,
        bounty_formatted: `$${item.usd.toLocaleString("en-US")}`,
        labels: [],
        assignees: [],
        body: "",
        comment_count: 0,
        created_at: new Date().toISOString(), // Boss API has no creation date; use fetch time
      };
    });
}

/**
 * Fetches all open bounties from Boss.dev.
 */
export async function fetchBossBounties(
  filters?: { min_bounty?: number }
): Promise<BountyIssue[]> {
  let response: Response;
  try {
    response = await fetch(BOSS_API, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`Boss.dev API network error: ${err instanceof Error ? err.message : err}`);
  }
  if (!response.ok) throw new Error(`Boss.dev API error: ${response.status}`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Boss.dev API returned invalid JSON");
  }
  if (!Array.isArray(data)) {
    throw new Error("Boss.dev API returned unexpected response format");
  }
  return parseBossResponse(data as BossItem[], filters);
}

/**
 * Converts BossSource config to filter params.
 */
export function buildBossFilters(boss: BossSource): { min_bounty?: number } {
  return {
    min_bounty: boss.min_bounty > 0 ? boss.min_bounty : undefined,
  };
}
