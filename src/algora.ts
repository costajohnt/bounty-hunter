import type { AlgoraSource, BountyIssue } from "./types.js";

const ALGORA_BASE = "https://algora.io/api/trpc/bounty.list";

interface AlgoraQueryParams {
  limit?: number;
  cursor?: string | null;
}

interface AlgoraFilterParams {
  min_bounty?: number;
  languages?: string[];
  keywords_exclude?: string[];
  max_pages?: number;
}

interface AlgoraItem {
  id: string;
  status: string;
  reward: { currency: string; amount: number };
  reward_formatted: string;
  tech: string[];
  created_at: string;
  task: {
    number: number;
    title: string;
    url: string;
    body: string;
    repo_name: string;
    repo_owner: string;
  };
  org: { handle: string; name: string };
}

interface AlgoraResponse {
  result: {
    data: {
      json: {
        items: AlgoraItem[];
        next_cursor: string | null;
      };
    };
  };
}

export function buildAlgoraUrl(params: AlgoraQueryParams): string {
  const json: Record<string, unknown> = {
    status: "open",
    limit: params.limit ?? 50,
  };
  if (params.cursor) {
    json.cursor = params.cursor;
  }
  const input = { "0": { json } };
  return `${ALGORA_BASE}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
}

function parseSingleResponse(raw: AlgoraResponse[]): { items: AlgoraItem[]; nextCursor: string | null } {
  const data = raw[0]?.result?.data?.json;
  return {
    items: data?.items ?? [],
    nextCursor: data?.next_cursor ?? null,
  };
}

function applyAlgoraFilters(items: AlgoraItem[], filters?: AlgoraFilterParams): BountyIssue[] {
  return items
    .filter((item) => {
      if (filters?.min_bounty && item.reward.amount / 100 < filters.min_bounty) {
        return false;
      }
      if (filters?.languages?.length && !item.tech.some((t) => filters.languages!.includes(t))) {
        return false;
      }
      if (filters?.keywords_exclude?.length) {
        const text = (item.task.title + " " + item.task.body).toLowerCase();
        if (filters.keywords_exclude.some((kw) => text.includes(kw.toLowerCase()))) {
          return false;
        }
      }
      return true;
    })
    .map((item) => ({
      source: "algora" as const,
      repo: `${item.task.repo_owner}/${item.task.repo_name}`,
      number: item.task.number,
      title: item.task.title,
      url: item.task.url,
      bounty_amount: item.reward.amount / 100,
      bounty_formatted: item.reward_formatted,
      labels: [],
      assignees: [],
      body: item.task.body,
      comment_count: 0,
      created_at: item.created_at,
      tech: item.tech,
    }));
}

export function parseAlgoraResponse(
  raw: AlgoraResponse[],
  filters?: AlgoraFilterParams
): BountyIssue[] {
  const { items } = parseSingleResponse(raw);
  return applyAlgoraFilters(items, filters);
}

export function buildAlgoraFilters(algora: AlgoraSource): AlgoraFilterParams {
  return {
    min_bounty: algora.min_bounty,
    languages: algora.languages.length ? algora.languages : undefined,
    keywords_exclude: algora.keywords_exclude,
    max_pages: algora.max_pages,
  };
}

export async function fetchAlgoraBounties(
  filters?: AlgoraFilterParams
): Promise<BountyIssue[]> {
  const maxPages = filters?.max_pages ?? 3;
  const allItems: AlgoraItem[] = [];
  let cursor: string | null = null;
  let page = 0;

  do {
    const url = buildAlgoraUrl({ limit: 50, cursor });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Algora API error: ${response.status}`);
    const data = (await response.json()) as AlgoraResponse[];
    const { items, nextCursor } = parseSingleResponse(data);
    allItems.push(...items);
    cursor = nextCursor;
    page++;
  } while (cursor && page < maxPages);

  return applyAlgoraFilters(allItems, filters);
}
