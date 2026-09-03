import { readFileSync } from "node:fs";
import { z } from "zod";
import type {
  CheckAdapter,
  MetaAdapter,
  PlaybookAdapter,
  RegulationAdapter,
  SourceAdapter,
  TestAdapter,
} from "./adapters.ts";
import { deriveTaxonomy } from "./areas.ts";
import { computeReferrers } from "./referrers.ts";
import {
  checkSearchFields,
  playbookSearchFields,
  rankedSearch,
  regulationSearchFields,
  testSearchFields,
} from "./search.ts";
import {
  CheckSchema,
  CorpusInfoSchema,
  PlaybookSchema,
  RegulationSchema,
  ReviewAreaSchema,
  SourceSchema,
  TestSchema,
  regulationIdSchema,
} from "./schema.ts";
import type {
  Check,
  CheckId,
  CorpusInfo,
  Playbook,
  PlaybookId,
  Referrers,
  Regulation,
  RegulationId,
  ReviewArea,
  Source,
  SourceId,
  Test,
  TestId,
} from "./schema.ts";
import { staleSourceIds } from "./validate.ts";

// --- Corpus file schema -------------------------------------------------------

/**
 * A past (or current-boundary) version of a regulation record, keyed by the
 * ISO date it entered into force. Entries live under the corpus file's
 * optional `regulation_history` key and power `get(id, asOf)`.
 */
export const RegulationHistoryEntrySchema = z.object({
  id: regulationIdSchema,
  effective_from: z.string().date(),
  record: RegulationSchema,
});
export type RegulationHistoryEntry = z.infer<typeof RegulationHistoryEntrySchema>;

export const CorpusFileSchema = z.object({
  regulation: z.array(RegulationSchema).default([]),
  tests: z.array(TestSchema).default([]),
  checks: z.array(CheckSchema).default([]),
  playbooks: z.array(PlaybookSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  taxonomy: z.array(ReviewAreaSchema).default([]),
  // Optional per-regulation version history for as-of resolution. Entries are
  // PAST versions with the date each entered into force; a corpus that wants
  // the CURRENT version selectable under as_of includes one entry whose
  // `record` is the current text with its effective boundary (the in-memory
  // demo follows the same convention). loadCorpusFile defaults this to [].
  regulation_history: z.array(RegulationHistoryEntrySchema).default([]),
  corpus_info: CorpusInfoSchema.optional(),
});

// `regulation_history` stays optional on the exported TYPE (parse always
// materializes it) so existing callers constructing CorpusFile literals —
// e.g. the dashboard's corpus merger — keep compiling unchanged.
export type CorpusFile = Omit<z.infer<typeof CorpusFileSchema>, "regulation_history"> & {
  regulation_history?: RegulationHistoryEntry[];
};

export function loadCorpusFile(path: string): CorpusFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return CorpusFileSchema.parse(raw);
}

// --- Citation resolution --------------------------------------------------

// Common citation abbreviations, expanded during normalization so
// "Art. 178(1)(a)" and "CRR Article 178(1)(a)" normalize into comparable forms.
const CITATION_EXPANSIONS: Record<string, string> = {
  art: "article",
  arts: "articles",
  par: "paragraph",
  para: "paragraph",
  paras: "paragraphs",
  gl: "guidelines",
};

function citationTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => CITATION_EXPANSIONS[t] ?? t);
}

const normalizeCitation = (text: string): string => citationTokens(text).join("");

/** Path segments of a regulation id after the framework, lowercased. */
function idSegments(id: RegulationId): string[] {
  return id
    .slice("regulation://".length)
    .split("/")
    .slice(1)
    .map((s) => s.toLowerCase());
}

const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const endsWithSegments = (segs: string[], suffix: string[]): boolean =>
  suffix.length > 0 &&
  suffix.length <= segs.length &&
  arraysEqual(segs.slice(segs.length - suffix.length), suffix);

/**
 * Loose citation string → Regulation, deterministic. Matching passes:
 *
 *   (i)   exact normalized-citation equality — both sides lowercased, split on
 *         punctuation/whitespace, abbreviations expanded (art→article,
 *         para→paragraph, gl→guidelines), rejoined;
 *   (ii)  normalized-citation containment in either direction, preferring the
 *         candidate whose normalized length is closest to the query's, then
 *         corpus order;
 *   (iii) article/paragraph/point extraction — numeric and single-letter
 *         tokens ("178(1)(a)" ⇒ ["178","1","a"]) matched against the id path
 *         segments after the framework (regulation://{fw}/178/1/a), filtered
 *         by a framework token when the query names one; exact segment match
 *         preferred over suffix match, ties broken by corpus order.
 */
export function resolveCitationIn(regulations: Regulation[], text: string): Regulation | null {
  const nq = normalizeCitation(text);
  if (nq.length === 0) return null;

  // (i) exact normalized equality.
  for (const r of regulations) {
    if (normalizeCitation(r.citation) === nq) return r;
  }

  // (ii) containment either direction.
  if (nq.length >= 3) {
    let best: Regulation | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const r of regulations) {
      const nc = normalizeCitation(r.citation);
      if (nc.length < 3) continue;
      if (!nc.includes(nq) && !nq.includes(nc)) continue;
      const gap = Math.abs(nc.length - nq.length);
      if (gap < bestGap) {
        best = r;
        bestGap = gap;
      }
    }
    if (best !== null) return best;
  }

  // (iii) segment extraction against id paths.
  const tokens = citationTokens(text);
  const frameworks = new Set(regulations.map((r) => r.framework.toLowerCase()));
  const frameworkHint = tokens.find((t) => frameworks.has(t));
  const segments = tokens.filter((t) => /^\d+$/.test(t) || /^[a-z]$/.test(t));
  if (segments.length === 0) return null;

  const candidates =
    frameworkHint === undefined
      ? regulations
      : regulations.filter((r) => r.framework.toLowerCase() === frameworkHint);

  const exact = candidates.find((r) => arraysEqual(idSegments(r.id), segments));
  if (exact !== undefined) return exact;
  return candidates.find((r) => endsWithSegments(idSegments(r.id), segments)) ?? null;
}

// --- File-backed adapters -------------------------------------------------

export function createFileAdapters(corpus: CorpusFile): {
  regulation: RegulationAdapter;
  test: TestAdapter;
  check: CheckAdapter;
  playbook: PlaybookAdapter;
  source: SourceAdapter;
  meta: MetaAdapter;
} {
  const regMap = new Map<RegulationId, Regulation>(corpus.regulation.map(r => [r.id, r]));
  const testMap = new Map<TestId, Test>(corpus.tests.map(t => [t.id, t]));
  const checkMap = new Map<CheckId, Check>(corpus.checks.map(c => [c.id, c]));
  const playbookMap = new Map<PlaybookId, Playbook>(corpus.playbooks.map(p => [p.id, p]));
  const sourceMap = new Map<SourceId, Source>(corpus.sources.map(s => [s.id, s]));

  // Version history per regulation id, sorted ascending by effective_from
  // (lexicographic ISO-date compare — the repo-wide convention).
  const historyMap = new Map<RegulationId, RegulationHistoryEntry[]>();
  for (const entry of corpus.regulation_history ?? []) {
    const existing = historyMap.get(entry.id);
    if (existing === undefined) historyMap.set(entry.id, [entry]);
    else existing.push(entry);
  }
  for (const entries of historyMap.values()) {
    entries.sort((a, b) => (a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : 0));
  }

  const regulation: RegulationAdapter = {
    async search(query) {
      return rankedSearch(corpus.regulation, query, regulationSearchFields(query)).map(m => m.record);
    },
    // As-of semantics (mirrors the in-memory demo's HISTORICAL_REGULATIONS
    // selection logic exactly):
    //   - no asOf                  → current record (or null if unknown);
    //   - asOf, no history for id  → current record — the only version the
    //     corpus knows; corpora without history keep their pre-history behavior;
    //   - asOf, history present    → the last entry with effective_from <= asOf
    //     (entries sorted ascending). The current version is selectable only
    //     when the corpus includes a history entry carrying it; if asOf
    //     predates every known version the answer is null, never current text
    //     masquerading as historical.
    async get(id, asOf) {
      const current = regMap.get(id) ?? null;
      if (asOf === undefined) return current;
      const history = historyMap.get(id);
      if (history === undefined) return current;
      let chosen: Regulation | null = null;
      for (const entry of history) {
        if (entry.effective_from <= asOf) chosen = entry.record;
        else break;
      }
      return chosen;
    },
    async list() { return corpus.regulation; },
  };

  const test: TestAdapter = {
    async search(query) {
      return rankedSearch(corpus.tests, query, testSearchFields).map(m => m.record);
    },
    async get(id) { return testMap.get(id) ?? null; },
    async list() { return corpus.tests; },
  };

  const check: CheckAdapter = {
    async search(query) {
      return rankedSearch(corpus.checks, query, checkSearchFields).map(m => m.record);
    },
    async get(id) { return checkMap.get(id) ?? null; },
    async list() { return corpus.checks; },
  };

  const playbook: PlaybookAdapter = {
    async search(query) {
      return rankedSearch(corpus.playbooks, query, playbookSearchFields).map(m => m.record);
    },
    async get(id) { return playbookMap.get(id) ?? null; },
    async list() { return corpus.playbooks; },
  };

  const source: SourceAdapter = {
    async list(filter) {
      const status = filter?.status;
      return status === undefined ? corpus.sources : corpus.sources.filter(s => s.status === status);
    },
    async get(id) { return sourceMap.get(id) ?? null; },
  };

  const meta: MetaAdapter = {
    async info(): Promise<CorpusInfo> {
      // Source count and staleness are computed at serve time even when the
      // file ships a corpus_info block — stored currency data is stale by definition.
      const stale_sources = staleSourceIds(corpus.sources);
      if (corpus.corpus_info) {
        return {
          ...corpus.corpus_info,
          counts: { ...corpus.corpus_info.counts, source: corpus.sources.length },
          stale_sources,
        };
      }
      return {
        last_updated: new Date().toISOString(),
        counts: {
          regulation: corpus.regulation.length,
          test: corpus.tests.length,
          check: corpus.checks.length,
          playbook: corpus.playbooks.length,
          source: corpus.sources.length,
        },
        coverage: [...new Set(corpus.regulation.map(r => r.framework.toUpperCase()))],
        stale_sources,
      };
    },
    async referrers(id: string): Promise<Referrers> {
      return computeReferrers(
        {
          regulation: corpus.regulation,
          tests: corpus.tests,
          checks: corpus.checks,
          playbooks: corpus.playbooks,
        },
        id,
      );
    },
    async resolveCitation(text: string): Promise<Regulation | null> {
      return resolveCitationIn(corpus.regulation, text);
    },
    async taxonomy(): Promise<ReviewArea[]> {
      // An authored taxonomy wins: it can name areas the corpus does not cover
      // yet, which a derived one cannot. With none, derive from the playbooks
      // rather than serving [] — an empty list here takes list_review_areas
      // AND get_area_overview out of service, and those are the entry path.
      return corpus.taxonomy.length > 0 ? corpus.taxonomy : deriveTaxonomy(corpus.playbooks);
    },
  };

  return { regulation, test, check, playbook, source, meta };
}
