// Send a listing to the Notion "Jobs" database, where applications are tracked.
//
// Config (wrangler.jsonc vars + a secret):
//   NOTION_TOKEN           secret: internal integration token (ntn_...), shared with the database
//   NOTION_DATA_SOURCE_ID  the Jobs database's data source
//   NOTION_TITLE_PROPERTY  title property, default "Position"
//   NOTION_URL_PROPERTY    URL property, default "Link"
//
// The page body is the job description: paragraphs, with "• " lines as bullets.

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03"; // data-source parents (databases can have several sources)

const MAX_TEXT = 2000; // per rich_text item
const MAX_BLOCKS_PER_REQUEST = 100;

export interface NotionConfig {
  token: string;
  dataSourceId: string;
  titleProperty: string;
  urlProperty: string;
}

export interface NotionJob {
  title: string;
  company: string;
  url: string;
  description: string | null;
}

/** Returns null when Notion isn't configured, so the route can say so. */
export function notionConfig(env: Env): NotionConfig | null {
  if (!env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID) return null;
  return {
    token: env.NOTION_TOKEN,
    dataSourceId: env.NOTION_DATA_SOURCE_ID,
    titleProperty: env.NOTION_TITLE_PROPERTY || "Position",
    urlProperty: env.NOTION_URL_PROPERTY || "Link",
  };
}

export class NotionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function notion<T>(cfg: NotionConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: { message?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    // Fall through: an error status still reports below; a success without a
    // readable body would otherwise hand callers an empty page.
  }
  if (!res.ok) throw new NotionError(res.status, `Notion ${res.status}: ${data?.message ?? res.statusText}`);
  if (!data || typeof data !== "object") throw new NotionError(res.status, `Notion ${res.status}: unreadable response`);
  return data as T;
}

interface Page {
  id: string;
  url: string;
}

/** A page in the database whose URL property is this posting, if any (e.g. one added by hand). */
export async function findJobPage(cfg: NotionConfig, url: string): Promise<Page | null> {
  const { results } = await notion<{ results: Page[] }>(cfg, "POST", `/data_sources/${cfg.dataSourceId}/query`, {
    filter: { property: cfg.urlProperty, url: { equals: url } },
    page_size: 1,
  });
  return results[0] ?? null;
}

/** Create the page: title + URL properties, description as the body. */
export async function createJobPage(cfg: NotionConfig, job: NotionJob): Promise<Page> {
  const blocks = descriptionBlocks(job.description);
  const page = await notion<Page>(cfg, "POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: cfg.dataSourceId },
    properties: {
      [cfg.titleProperty]: { title: richText(`${job.title} @ ${job.company}`) },
      [cfg.urlProperty]: { url: job.url },
    },
    children: blocks.slice(0, MAX_BLOCKS_PER_REQUEST),
  });
  // Long descriptions: the rest goes on in batches of 100.
  try {
    for (let i = MAX_BLOCKS_PER_REQUEST; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
      await notion(cfg, "PATCH", `/blocks/${page.id}/children`, {
        children: blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST),
      });
    }
  } catch (err) {
    // Trash the half-written page, or the retry's findJobPage would link it
    // as if it were complete.
    await notion(cfg, "PATCH", `/pages/${page.id}`, { in_trash: true }).catch(() => {});
    throw err;
  }
  return page;
}

// --- description -> blocks -------------------------------------------------

type Block = { object: "block"; type: string } & Record<string, unknown>;

function richText(s: string) {
  const out = [];
  for (let i = 0; i < s.length; ) {
    let end = Math.min(i + MAX_TEXT, s.length);
    // Don't split a surrogate pair (emoji etc.) across two items.
    if (end < s.length && /[\uD800-\uDBFF]/.test(s[end - 1])) end--;
    out.push({ type: "text", text: { content: s.slice(i, end) } });
    i = end;
  }
  return out;
}

const block = (type: string, text: string): Block => ({ object: "block", type, [type]: { rich_text: richText(text) } });

/**
 * Descriptions are plain text (see sources.ts): blank lines separate
 * paragraphs and list items start with "• ". A short line that opens a
 * paragraph and is followed by a bullet ("Requirements:" then "• ...") is
 * treated as a heading.
 */
export function descriptionBlocks(description: string | null): Block[] {
  if (!description?.trim()) return [block("paragraph", "No description provided.")];
  const blocks: Block[] = [];
  for (const para of description.split(/\n\s*\n/)) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    let text: string[] = [];
    const flush = () => {
      if (text.length) blocks.push(block("paragraph", text.join("\n")));
      text = [];
    };
    lines.forEach((line, i) => {
      const bullet = line.match(BULLET);
      if (bullet) {
        flush();
        blocks.push(block("bulleted_list_item", bullet[1]));
      } else if (i === 0 && BULLET.test(lines[1] ?? "") && isHeading(line)) {
        blocks.push(block("heading_3", line.replace(/:$/, "")));
      } else {
        text.push(line);
      }
    });
    flush();
  }
  return blocks;
}

const BULLET = /^[•\-*·]\s+(.*)$/;
const isHeading = (line: string) => line.length <= 60 && !/[.,;!?)]$/.test(line);
