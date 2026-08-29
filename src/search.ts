/**
 * Deterministic field-scoped ranked search — shared by every adapter that
 * implements `search(query)`.
 *
 * Replaces the old JSON.stringify substring scan, which matched keys and URIs
 * (query "regulation" hit 100% of records) and dumped the whole corpus on an
 * empty query. Contract here:
 *
 *   - The query is tokenized (lowercased, split on non-alphanumerics, empties
 *     dropped). An empty or whitespace-only query returns [] — enumeration is
 *     `list()`'s job, never search's.
 *   - Only the declared fields are scanned, each with a weight. Score = sum
 *     over tokens of `weight × occurrences`; a whole-word occurrence counts
 *     full weight, a substring-only occurrence counts half.
 *   - Results are sorted by score descending, ties broken by input order, so
 *     the ranking is fully deterministic.
 *   - Each result carries the matched field and a ~120-char excerpt around
 *     the first match in the record's best-scoring field.
 *
 * The per-surface field sets live at the bottom of this file so ranking
 * behavior is defined once and reused by the file adapter, the in-memory
 * demo, and any external backend that wants parity.
 */
import type { Check, Playbook, Regulation, Source, Test } from "./schema.ts";

// --- Core -----------------------------------------------------------------

export interface SearchField<T = unknown> {
  name: string;
  weight: number;
  get(record: T): string | string[] | undefined;
}

export interface SearchMatch<T> {
  record: T;
  score: number;
  matched: { field: string; excerpt: string };
}

const DEFAULT_LIMIT = 20;
const EXCERPT_WINDOW = 120;

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

const isAlphanumeric = (ch: string): boolean => /[a-z0-9]/.test(ch);

/** Occurrence counts of `needle` in lowercase `haystack`, plus first index. */
function countOccurrences(
  haystack: string,
  needle: string,
): { total: number; whole: number; first: number } {
  let total = 0;
  let whole = 0;
  let first = -1;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    if (first === -1) first = i;
    total += 1;
    const before = i === 0 ? "" : haystack[i - 1]!;
    const after = i + needle.length >= haystack.length ? "" : haystack[i + needle.length]!;
    if (!isAlphanumeric(before) && !isAlphanumeric(after)) whole += 1;
    i = haystack.indexOf(needle, i + 1);
  }
  return { total, whole, first };
}

function makeExcerpt(text: string, index: number): string {
  if (text.length <= EXCERPT_WINDOW) return text;
  const start = Math.max(0, Math.min(index - Math.floor(EXCERPT_WINDOW / 3), text.length - EXCERPT_WINDOW));
  const end = Math.min(text.length, start + EXCERPT_WINDOW);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function rankedSearch<T>(
  items: T[],
  query: string,
  fields: SearchField<T>[],
  limit: number = DEFAULT_LIMIT,
): SearchMatch<T>[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored: Array<SearchMatch<T> & { order: number }> = [];

  items.forEach((record, order) => {
    let total = 0;
    let best: { field: string; score: number; text: string; index: number } | null = null;

    for (const field of fields) {
      const raw = field.get(record);
      if (raw === undefined) continue;
      const values = Array.isArray(raw) ? raw : [raw];

      let fieldScore = 0;
      let anchorText: string | null = null;
      let anchorIndex = 0;

      for (const value of values) {
        const lower = value.toLowerCase();
        let valueFirst = Number.POSITIVE_INFINITY;
        for (const token of tokens) {
          const occ = countOccurrences(lower, token);
          if (occ.total === 0) continue;
          // Whole-word occurrences at full weight, substring-only at half.
          fieldScore += field.weight * (occ.whole + 0.5 * (occ.total - occ.whole));
          if (occ.first < valueFirst) valueFirst = occ.first;
        }
        if (valueFirst !== Number.POSITIVE_INFINITY && anchorText === null) {
          anchorText = value;
          anchorIndex = valueFirst;
        }
      }

      if (fieldScore > 0 && anchorText !== null) {
        total += fieldScore;
        if (best === null || fieldScore > best.score) {
          best = { field: field.name, score: fieldScore, text: anchorText, index: anchorIndex };
        }
      }
    }

    if (total > 0 && best !== null) {
      scored.push({
        record,
        score: total,
        matched: { field: best.field, excerpt: makeExcerpt(best.text, best.index) },
        order,
      });
    }
  });

  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ record, score, matched }) => ({ record, score, matched }));
}

// --- Per-surface field sets -------------------------------------------------

/** URI-ish queries ("regulation://crr/180", "crr/180") may match on `id`. */
const looksUriLike = (query: string): boolean => query.includes("://") || query.includes("/");

/**
 * Regulation fields depend on the query: `id` participates (at low weight)
 * only when the query looks URI-like, so prose queries like "regulation"
 * no longer match every record through its URI scheme.
 */
export function regulationSearchFields(query: string): SearchField<Regulation>[] {
  const fields: SearchField<Regulation>[] = [
    { name: "citation", weight: 3, get: (r) => r.citation },
    { name: "text", weight: 2, get: (r) => r.text },
    { name: "commentary", weight: 1, get: (r) => r.commentary.map((c) => c.text) },
  ];
  if (looksUriLike(query)) fields.push({ name: "id", weight: 0.5, get: (r) => r.id });
  return fields;
}

export const testSearchFields: SearchField<Test>[] = [
  { name: "name", weight: 3, get: (t) => t.name },
  { name: "aliases", weight: 3, get: (t) => t.aliases },
  { name: "family", weight: 2, get: (t) => t.family },
  { name: "purpose", weight: 2, get: (t) => t.purpose },
  { name: "acceptance_criteria", weight: 1, get: (t) => t.acceptance_criteria },
];

export const checkSearchFields: SearchField<Check>[] = [
  { name: "name", weight: 3, get: (c) => c.name },
  { name: "expectation", weight: 2, get: (c) => c.expectation },
  { name: "expected_evidence", weight: 1, get: (c) => c.expected_evidence },
];

export const playbookSearchFields: SearchField<Playbook>[] = [
  { name: "area", weight: 3, get: (p) => p.area },
  { name: "subarea", weight: 3, get: (p) => p.subarea },
  { name: "phase_names", weight: 2, get: (p) => p.phases.map((ph) => ph.name) },
  { name: "phase_descriptions", weight: 1, get: (p) => p.phases.map((ph) => ph.description) },
];

export const sourceSearchFields: SearchField<Source>[] = [
  { name: "title", weight: 3, get: (s) => s.title },
  { name: "document_id", weight: 2, get: (s) => s.document_id },
  { name: "framework", weight: 1, get: (s) => s.framework },
  { name: "notes", weight: 1, get: (s) => s.notes },
];
