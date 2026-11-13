import { ago } from "./format";
import type { Company } from "./types";

export const CATEGORY_LABELS: Record<string, string> = {
  "inference-platform": "Inference platforms",
  neocloud: "Neoclouds",
  "inference-silicon": "Inference silicon",
  "inference-software": "Inference software",
  "efficient-models": "Efficient models",
};

/** Display name for a category; new ones ("frontier-labs") become "Frontier labs". */
export const categoryLabel = (cat: string) =>
  CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, " ");

const ORDER = Object.keys(CATEGORY_LABELS);
const rank = (cat: string) => (ORDER.includes(cat) ? ORDER.indexOf(cat) : ORDER.length);

/** Known categories in display order, then the rest; by name within a category. */
export const sortCompanies = (cs: Company[]) =>
  cs.sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));

/**
 * `health` comes from /api/companies (see src/health.ts). Solid dot: the poll
 * failed with an error. Hollow dot: it died without one, or hasn't succeeded lately.
 */
export function healthProblem(c: Company): { dot: string; text: string } | null {
  switch (c.health) {
    case "failed":
      return { dot: "●", text: `Last fetch failed: ${c.last_error}` };
    case "interrupted":
      return { dot: "○", text: `Last poll started ${ago(c.last_attempt_at!)} but never finished (likely hit the CPU limit)` };
    case "stale":
      return { dot: "○", text: `No successful poll since ${ago(c.last_success_at!)}` };
    default:
      return null;
  }
}

export const ATS_LABELS = { ashby: "Ashby", greenhouse: "Greenhouse", gem: "Gem", lever: "Lever" } as const;

const BOARD_HOSTS: Record<keyof typeof ATS_LABELS, string> = {
  ashby: "jobs.ashbyhq.com",
  greenhouse: "job-boards.greenhouse.io",
  gem: "jobs.gem.com",
  lever: "jobs.lever.co",
};

/** The public careers page for a board. */
export const boardUrl = (ats: string, slug: string) =>
  `https://${BOARD_HOSTS[ats as keyof typeof BOARD_HOSTS] ?? ats}/${encodeURIComponent(slug)}`;

/**
 * Pull the job board and slug out of a pasted careers-page or API URL, e.g.
 * jobs.ashbyhq.com/baseten or boards.greenhouse.io/togetherai/jobs/123.
 */
export function parseBoardUrl(input: string): { ats: keyof typeof ATS_LABELS; slug: string } | null {
  const patterns: [keyof typeof ATS_LABELS, RegExp][] = [
    ["ashby", /(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com\/posting-api\/job-board)\/([^/?#]+)/i],
    ["greenhouse", /(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i],
    ["greenhouse", /boards-api\.greenhouse\.io\/v1\/boards\/([^/?#]+)/i],
    ["gem", /(?:jobs\.gem\.com|api\.gem\.com\/job_board\/v0)\/([^/?#]+)/i],
    ["lever", /(?:jobs\.lever\.co|api\.lever\.co\/v0\/postings)\/([^/?#]+)/i],
  ];
  for (const [ats, re] of patterns) {
    const m = input.match(re);
    if (!m) continue;
    try {
      return { ats, slug: decodeURIComponent(m[1]) };
    } catch {
      return null; // malformed escape, e.g. "acme%"
    }
  }
  return null;
}
