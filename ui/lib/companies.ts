import { ago } from "./format";
import type { Company } from "./types";

export const CATEGORY_LABELS: Record<string, string> = {
  "inference-platform": "Inference platforms",
  neocloud: "Neoclouds",
  "inference-silicon": "Inference silicon",
  "inference-software": "Inference software",
  "efficient-models": "Efficient models",
};

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
